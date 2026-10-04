import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import {
  CommerceService,
  DeterministicModelledOrderProvider,
  ModelledPaymentProvider,
  OrderEvidenceService,
  TrustService,
} from "@conduit/application";
import {
  createAuthorizationGrantSchema,
  createBuyerSchema,
  trustedCommitSchema,
} from "@conduit/contracts";
import { orderId } from "@conduit/domain";
import type { PricedCart } from "@conduit/domain";
import {
  PostgresCommerceRepository,
  PostgresOrderEvidenceRepository,
  PostgresTrustRepository,
} from "@conduit/infrastructure";
import type { Pool, QueryResultRow } from "@conduit/infrastructure";
import {
  UCP_CART,
  UCP_CHECKOUT,
  UCP_VERSION,
  UcpAuthenticationError,
  authenticateUcpApiKey,
  digestApiKey,
  projectUcpCart,
  projectUcpCheckout,
  ucpCartRequestSchema,
  ucpCheckoutRequestSchema,
  ucpError,
} from "@conduit/protocol-adapters";
import type {
  UcpApiKeyCredential,
  UcpCheckoutState,
  UcpPrincipal,
} from "@conduit/protocol-adapters";

interface CheckoutRow extends QueryResultRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly cart_id: string;
  readonly status: "REQUIRES_ESCALATION" | "COMPLETED" | "CANCELED";
  readonly review_token_digest: string;
  readonly expires_at: Date;
  readonly order_id: string | null;
}

interface ApiResult {
  readonly status: number;
  readonly body: unknown;
  readonly replayed?: boolean;
}

const agentProfile = "https://buyer-agent.example/.well-known/ucp";

export async function createUcpShoppingDemoSurface(pool: Pool, baseUrl: string) {
  const commerce = new CommerceService(
    new PostgresCommerceRepository(pool),
    new DeterministicModelledOrderProvider(),
  );
  const trust = new TrustService(
    new PostgresTrustRepository(pool),
    new ModelledPaymentProvider(),
  );
  const orderEvidence = new OrderEvidenceService(
    new PostgresOrderEvidenceRepository(pool),
  );
  const suffix = crypto.randomUUID().slice(0, 8);
  const tenant = await commerce.createTenant({
    slug: `ucp-shop-${suffix}`,
    displayName: "CONDUIT UCP Shop",
  });
  const merchant = await commerce.createMerchant({
    tenantId: tenant.id,
    slug: "trusted-tea",
    displayName: "Trusted Tea Merchant",
    currency: "INR",
  });
  const product = await commerce.createProduct({
    tenantId: tenant.id,
    merchantId: merchant.id,
    sku: "UCP-TEA-1",
    displayName: "UCP Assam Tea",
    description: "A protocol demo product backed by the canonical catalog.",
    category: "tea",
    attributes: { origin: "Assam" },
    price: { currency: "INR", minorUnits: "24900" },
    stock: 20,
  });
  const buyer = await trust.createBuyer(
    createBuyerSchema.parse({
      tenantId: tenant.id,
      displayName: "UCP Demo Buyer",
    }),
  );
  const grant = await trust.createAuthorizationGrant(
    createAuthorizationGrantSchema.parse({
      tenantId: tenant.id,
      buyerId: buyer.id,
      merchantId: merchant.id,
      maximumAmount: { currency: "INR", minorUnits: "100000" },
      allowedCategories: ["tea"],
      allowedSkus: ["UCP-TEA-1"],
      expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
      policyVersion: "trust-v1",
    }),
  );
  const secret = `conduit_ucp_${crypto.randomUUID()}`;
  const reviewSecret = crypto.randomUUID();
  const credential: UcpApiKeyCredential = {
    keyId: "runtime-ucp-shopping-demo-key",
    secretDigest: digestApiKey(secret),
    enabled: true,
    principalId: "conduit-demo-buyer-agent",
    tenantId: tenant.id,
    merchantId: merchant.id,
    agentProfile,
  };

  async function execute(
    method: string,
    path: string,
    headers: Readonly<Record<string, string | undefined>>,
    body?: unknown,
  ): Promise<ApiResult> {
    let principal: UcpPrincipal;
    try {
      principal = authenticateUcpApiKey(
        { authorization: headers.authorization, ucpAgent: headers["ucp-agent"] },
        [credential],
      );
    } catch (error: unknown) {
      if (error instanceof UcpAuthenticationError) {
        return { status: 401, body: { code: error.code, content: error.message } };
      }
      throw error;
    }

    if (method === "POST" && path === "/carts") {
      const parsed = ucpCartRequestSchema.safeParse(body);
      if (!parsed.success) return invalidRequest(parsed.error.issues[0]?.message);
      return idempotent(
        principal,
        "create_cart",
        headers["idempotency-key"],
        parsed.data,
        async () => {
          const existing = await pool.query<{ readonly cart_id: string }>(
            `SELECT cart_id FROM conduit.ucp_cart_bindings
             WHERE tenant_id = $1 AND principal_id = $2 AND idempotency_key = $3`,
            [principal.tenantId, principal.principalId, headers["idempotency-key"]],
          );
          const existingCartId = existing.rows[0]?.cart_id;
          if (existingCartId) {
            const existingCart = await commerce.getCart({
              tenantId: principal.tenantId,
              cartId: existingCartId,
            });
            return { status: 201, body: projectUcpCart(existingCart) };
          }
          const empty = await commerce.createCart({
            tenantId: principal.tenantId,
            merchantId: principal.merchantId,
          });
          const cart = await commerce.replaceCartLines({
            tenantId: principal.tenantId,
            cartId: empty.id,
            lines: parsed.data.line_items.map((line) => ({
              productId: line.item.id,
              quantity: line.quantity,
            })),
          });
          await pool.query(
            `INSERT INTO conduit.ucp_cart_bindings
               (tenant_id, merchant_id, cart_id, principal_id, agent_profile,
                idempotency_key)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              principal.tenantId,
              principal.merchantId,
              cart.id,
              principal.principalId,
              principal.agentProfile,
              headers["idempotency-key"],
            ],
          );
          return { status: 201, body: projectUcpCart(cart) };
        },
      );
    }

    const cartMatch = /^\/carts\/([0-9a-f-]+)$/u.exec(path);
    if (cartMatch?.[1] && method === "GET") {
      const cart = await ownedCart(principal, cartMatch[1]);
      return cart
        ? { status: 200, body: projectUcpCart(cart) }
        : { status: 200, body: ucpError("not_found", "Cart was not found") };
    }
    if (cartMatch?.[1] && method === "PUT") {
      const parsed = ucpCartRequestSchema.safeParse(body);
      if (!parsed.success) return invalidRequest(parsed.error.issues[0]?.message);
      const cartId = cartMatch[1];
      return idempotent(
        principal,
        `replace_cart:${cartId}`,
        headers["idempotency-key"],
        parsed.data,
        async () => {
          if (!(await ownedCart(principal, cartId))) {
            return { status: 200, body: ucpError("not_found", "Cart was not found") };
          }
          const cart = await commerce.replaceCartLines({
            tenantId: principal.tenantId,
            cartId,
            lines: parsed.data.line_items.map((line) => ({
              productId: line.item.id,
              quantity: line.quantity,
            })),
          });
          return { status: 200, body: projectUcpCart(cart) };
        },
      );
    }
    const cancelCartMatch = /^\/carts\/([0-9a-f-]+)\/cancel$/u.exec(path);
    if (cancelCartMatch?.[1] && method === "POST") {
      const cartId = cancelCartMatch[1];
      return idempotent(
        principal,
        `cancel_cart:${cartId}`,
        headers["idempotency-key"],
        {},
        async () => {
          const canceled = await pool.query(
            `UPDATE conduit.ucp_cart_bindings
             SET canceled_at = clock_timestamp()
             WHERE tenant_id = $1 AND cart_id = $2 AND principal_id = $3
               AND agent_profile = $4 AND canceled_at IS NULL`,
            [principal.tenantId, cartId, principal.principalId, principal.agentProfile],
          );
          return canceled.rowCount === 1
            ? { status: 200, body: ucpError("not_found", "Cart was canceled") }
            : { status: 200, body: ucpError("not_found", "Cart was not found") };
        },
      );
    }

    if (method === "POST" && path === "/checkout-sessions") {
      const parsed = ucpCheckoutRequestSchema.safeParse(body);
      if (!parsed.success) return invalidRequest(parsed.error.issues[0]?.message);
      return idempotent(
        principal,
        "create_checkout",
        headers["idempotency-key"],
        parsed.data,
        async () => {
          const cart = await ownedCart(principal, parsed.data.cart_id);
          if (!cart) {
            return { status: 200, body: ucpError("not_found", "Cart was not found") };
          }
          if (cart.lines.length === 0) {
            return { status: 200, body: ucpError("empty_cart", "Cart has no items") };
          }
          const checkoutId = crypto.randomUUID();
          const token = reviewToken(checkoutId);
          await pool.query(
            `INSERT INTO conduit.ucp_checkout_sessions (
               id, tenant_id, merchant_id, cart_id, grant_id, principal_id,
               agent_profile, review_token_digest, operation_key, expires_at
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,clock_timestamp() + interval '6 hours')
             ON CONFLICT (cart_id) DO NOTHING`,
            [
              checkoutId,
              principal.tenantId,
              principal.merchantId,
              cart.id,
              grant.id,
              principal.principalId,
              principal.agentProfile,
              sha256(token),
              `ucp-checkout:${checkoutId}`,
            ],
          );
          const checkout = await checkoutByCart(principal, cart.id);
          return {
            status: 201,
            body: await checkoutResponse(principal, checkout),
          };
        },
      );
    }

    const checkoutMatch = /^\/checkout-sessions\/([0-9a-f-]+)$/u.exec(path);
    if (checkoutMatch?.[1] && method === "GET") {
      const checkout = await ownedCheckout(principal, checkoutMatch[1]);
      return checkout
        ? { status: 200, body: await checkoutResponse(principal, checkout) }
        : { status: 200, body: ucpError("not_found", "Checkout was not found") };
    }
    if (checkoutMatch?.[1] && method === "PUT") {
      const parsed = ucpCartRequestSchema.safeParse(body);
      if (!parsed.success) return invalidRequest(parsed.error.issues[0]?.message);
      const checkoutId = checkoutMatch[1];
      return idempotent(
        principal,
        `update_checkout:${checkoutId}`,
        headers["idempotency-key"],
        parsed.data,
        async () => {
          const checkout = await ownedCheckout(principal, checkoutId);
          if (checkout?.status !== "REQUIRES_ESCALATION") {
            return {
              status: 200,
              body: ucpError("not_found", "Mutable checkout was not found"),
            };
          }
          await commerce.replaceCartLines({
            tenantId: principal.tenantId,
            cartId: checkout.cart_id,
            lines: parsed.data.line_items.map((line) => ({
              productId: line.item.id,
              quantity: line.quantity,
            })),
          });
          const updated = await ownedCheckout(principal, checkoutId);
          if (!updated) throw new Error("Updated checkout disappeared");
          return { status: 200, body: await checkoutResponse(principal, updated) };
        },
      );
    }
    const completeMatch = /^\/checkout-sessions\/([0-9a-f-]+)\/complete$/u.exec(path);
    if (completeMatch?.[1] && method === "POST") {
      const checkout = await ownedCheckout(principal, completeMatch[1]);
      return checkout
        ? { status: 200, body: await checkoutResponse(principal, checkout) }
        : { status: 200, body: ucpError("not_found", "Checkout was not found") };
    }
    const cancelCheckoutMatch = /^\/checkout-sessions\/([0-9a-f-]+)\/cancel$/u.exec(
      path,
    );
    if (cancelCheckoutMatch?.[1] && method === "POST") {
      const checkoutId = cancelCheckoutMatch[1];
      return idempotent(
        principal,
        `cancel_checkout:${checkoutId}`,
        headers["idempotency-key"],
        {},
        async () => {
          await pool.query(
            `UPDATE conduit.ucp_checkout_sessions
             SET status = 'CANCELED', updated_at = clock_timestamp()
             WHERE tenant_id = $1 AND id = $2 AND principal_id = $3
               AND status = 'REQUIRES_ESCALATION'`,
            [principal.tenantId, checkoutId, principal.principalId],
          );
          const canceled = await ownedCheckout(principal, checkoutId);
          return canceled
            ? { status: 200, body: await checkoutResponse(principal, canceled) }
            : { status: 200, body: ucpError("not_found", "Checkout was not found") };
        },
      );
    }
    return { status: 404, body: { code: "not_found", content: "Unknown operation" } };
  }

  async function approve(checkoutId: string, token: string): Promise<ApiResult> {
    return withCheckoutLock(checkoutId, async () => {
      const checkout = await ownedCheckout(credential, checkoutId);
      if (!checkout || checkout.status === "CANCELED") {
        return { status: 404, body: { error: "Checkout was not found" } };
      }
      if (checkout.expires_at.getTime() <= Date.now()) {
        return { status: 410, body: { error: "Checkout expired" } };
      }
      if (!safeDigestMatch(checkout.review_token_digest, sha256(token))) {
        return { status: 403, body: { error: "Invalid review link" } };
      }
      if (checkout.status === "COMPLETED") {
        return { status: 200, body: await trustedReviewResponse(checkout) };
      }
      const cart = await commerce.getCart({
        tenantId: tenant.id,
        cartId: checkout.cart_id,
      });
      const result = await trust.commit(
        trustedCommitSchema.parse({
          tenantId: tenant.id,
          cartId: cart.id,
          grantId: grant.id,
          operationKey: `ucp-checkout:${checkout.id}`,
          quote: quoteFrom(cart),
        }),
      );
      if (result.outcome !== "PENDING_PROVIDER" && result.outcome !== "REPLAYED") {
        return {
          status: 409,
          body: { error: result.outcome, decision: result.decision },
        };
      }
      const operation =
        result.operation.status === "CONFIRMED"
          ? result.operation
          : await trust.processNextProviderCommand();
      if (operation?.status !== "CONFIRMED") {
        return {
          status: 409,
          body: { error: operation?.status ?? "PROVIDER_PENDING" },
        };
      }
      await pool.query(
        `UPDATE conduit.ucp_checkout_sessions
       SET status = 'COMPLETED', reviewed_at = clock_timestamp(),
           operation_id = $3, order_id = $4, updated_at = clock_timestamp()
       WHERE tenant_id = $1 AND id = $2 AND status = 'REQUIRES_ESCALATION'`,
        [tenant.id, checkout.id, operation.id, operation.orderId],
      );
      const completed = await ownedCheckout(credential, checkout.id);
      if (!completed) throw new Error("Completed checkout disappeared");
      return { status: 200, body: await trustedReviewResponse(completed) };
    });
  }

  async function withCheckoutLock<TResult>(
    checkoutId: string,
    action: () => Promise<TResult>,
  ): Promise<TResult> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtext('ucp-checkout-approval'), hashtext($1))`,
        [checkoutId],
      );
      const result = await action();
      await client.query("COMMIT");
      return result;
    } catch (error: unknown) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async function review(checkoutId: string, token: string): Promise<ApiResult> {
    const checkout = await ownedCheckout(credential, checkoutId);
    if (!checkout || checkout.status === "CANCELED") {
      return { status: 404, body: { error: "Checkout was not found" } };
    }
    if (checkout.expires_at.getTime() <= Date.now()) {
      return { status: 410, body: { error: "Checkout expired" } };
    }
    if (!safeDigestMatch(checkout.review_token_digest, sha256(token))) {
      return { status: 403, body: { error: "Invalid review link" } };
    }
    return { status: 200, body: await trustedReviewResponse(checkout) };
  }

  async function runRoundTrip() {
    const headers = {
      authorization: `Bearer ${secret}`,
      "ucp-agent": `profile="${agentProfile}"`,
    };
    const cartKey = crypto.randomUUID();
    const cartBody = {
      line_items: [{ item: { id: product.id }, quantity: 2 }],
    };
    const createdCart = await execute(
      "POST",
      "/carts",
      {
        ...headers,
        "idempotency-key": cartKey,
      },
      cartBody,
    );
    const replay = await execute(
      "POST",
      "/carts",
      {
        ...headers,
        "idempotency-key": cartKey,
      },
      cartBody,
    );
    const conflict = await execute(
      "POST",
      "/carts",
      {
        ...headers,
        "idempotency-key": cartKey,
      },
      { line_items: [{ item: { id: product.id }, quantity: 3 }] },
    );
    const cartId = objectId(createdCart.body);
    const checkout = await execute(
      "POST",
      "/checkout-sessions",
      {
        ...headers,
        "idempotency-key": crypto.randomUUID(),
      },
      { cart_id: cartId, line_items: [] },
    );
    const checkoutId = objectId(checkout.body);
    const beforeApproval = await execute(
      "POST",
      `/checkout-sessions/${checkoutId}/complete`,
      { ...headers, "idempotency-key": crypto.randomUUID() },
      {},
    );
    const [approved, approvalReplay] = await Promise.all([
      approve(checkoutId, reviewToken(checkoutId)),
      approve(checkoutId, reviewToken(checkoutId)),
    ]);
    const afterApproval = await execute(
      "GET",
      `/checkout-sessions/${checkoutId}`,
      headers,
    );
    return {
      phase: 7,
      surface: "UCP_CART_CHECKOUT",
      title: "UCP cart to trusted buyer handoff",
      lesson:
        "The platform can build a server-priced cart, but only the buyer-facing trusted UI authorizes placement of the modelled order.",
      claimLevel: "MIXED_EXPLICIT",
      protocol: { version: UCP_VERSION, capabilities: [UCP_CART, UCP_CHECKOUT] },
      stages: {
        cart: createdCart,
        idempotentReplay: replay,
        mismatchedReplay: conflict,
        checkout,
        agentCompleteBeforeReview: beforeApproval,
        trustedUiApproval: approved,
        concurrentApprovalReplay: approvalReplay,
        finalCheckout: afterApproval,
      },
      receipt: evidenceFrom(approved.body),
      claims: {
        databaseAndTrustChecks: "REAL_LOCAL_DATABASE",
        paymentProvider: "MODELLED_NO_EXTERNAL_MONEY",
        publicUcpConformance: "NOT_CLAIMED",
        bearerSecretReturnedToBrowser: false,
      },
    };
  }

  async function idempotent(
    principal: UcpPrincipal,
    operation: string,
    key: string | undefined,
    requestBody: unknown,
    action: () => Promise<ApiResult>,
  ): Promise<ApiResult> {
    if (!key) return { status: 400, body: { code: "missing_idempotency_key" } };
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`, [
        `${principal.tenantId}:${principal.principalId}:${operation}`,
        key,
      ]);
      const digest = sha256(canonicalJson(requestBody));
      const cached = await client.query<
        QueryResultRow & {
          readonly request_digest: string;
          readonly status_code: number;
          readonly response_body: unknown;
        }
      >(
        `SELECT request_digest, status_code, response_body
         FROM conduit.ucp_idempotency_records
         WHERE tenant_id = $1 AND principal_id = $2 AND operation = $3
           AND idempotency_key = $4 AND created_at > clock_timestamp() - interval '24 hours'`,
        [principal.tenantId, principal.principalId, operation, key],
      );
      const previous = cached.rows[0];
      if (previous) {
        await client.query("COMMIT");
        return previous.request_digest === digest
          ? {
              status: previous.status_code,
              body: previous.response_body,
              replayed: true,
            }
          : {
              status: 409,
              body: {
                code: "idempotency_key_reused",
                content: "The key was already used with a different request body",
              },
            };
      }
      const result = await action();
      await client.query(
        `INSERT INTO conduit.ucp_idempotency_records
           (tenant_id, principal_id, operation, idempotency_key,
            request_digest, status_code, response_body)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
        [
          principal.tenantId,
          principal.principalId,
          operation,
          key,
          digest,
          result.status,
          JSON.stringify(result.body),
        ],
      );
      await client.query("COMMIT");
      return result;
    } catch (error: unknown) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async function ownedCart(principal: UcpPrincipal, cartId: string) {
    const binding = await pool.query(
      `SELECT 1 FROM conduit.ucp_cart_bindings
       WHERE tenant_id = $1 AND merchant_id = $2 AND cart_id = $3
         AND principal_id = $4 AND agent_profile = $5 AND canceled_at IS NULL`,
      [
        principal.tenantId,
        principal.merchantId,
        cartId,
        principal.principalId,
        principal.agentProfile,
      ],
    );
    return binding.rowCount === 1
      ? commerce.getCart({ tenantId: principal.tenantId, cartId })
      : null;
  }

  async function ownedCheckout(principal: UcpPrincipal, id: string) {
    const result = await pool.query<CheckoutRow>(
      `${checkoutSelect()} WHERE s.tenant_id = $1 AND s.id = $2
         AND s.principal_id = $3 AND s.agent_profile = $4`,
      [principal.tenantId, id, principal.principalId, principal.agentProfile],
    );
    return result.rows[0] ?? null;
  }

  async function checkoutByCart(principal: UcpPrincipal, cartId: string) {
    const result = await pool.query<CheckoutRow>(
      `${checkoutSelect()} WHERE s.tenant_id = $1 AND s.cart_id = $2
         AND s.principal_id = $3 AND s.agent_profile = $4`,
      [principal.tenantId, cartId, principal.principalId, principal.agentProfile],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Checkout session was not created");
    return row;
  }

  async function checkoutResponse(principal: UcpPrincipal, row: CheckoutRow) {
    const cart = await commerce.getCart({
      tenantId: principal.tenantId,
      cartId: row.cart_id,
    });
    const state: UcpCheckoutState = {
      id: row.id,
      cart,
      status:
        row.status === "REQUIRES_ESCALATION"
          ? "requires_escalation"
          : (row.status.toLowerCase() as "completed" | "canceled"),
      expiresAt: row.expires_at,
      ...(row.status === "REQUIRES_ESCALATION"
        ? {
            continueUrl: `${new URL(baseUrl).origin}/checkout/${row.id}?token=${reviewToken(row.id)}`,
          }
        : {}),
      ...(row.order_id ? { order: { id: row.order_id } } : {}),
    };
    return projectUcpCheckout(state);
  }

  async function trustedReviewResponse(row: CheckoutRow) {
    const checkout = await checkoutResponse(credential, row);
    if (!row.order_id) return checkout;
    const evidence = await orderEvidence.get(tenant.id, orderId(row.order_id));
    if (!evidence) throw new Error("Completed checkout has no order evidence");
    return { ...checkout, conduit_evidence: evidence };
  }

  function reviewToken(checkoutId: string): string {
    return createHmac("sha256", reviewSecret).update(checkoutId).digest("hex");
  }

  return { execute, approve, review, runRoundTrip };
}

function checkoutSelect(): string {
  return `SELECT s.id, s.tenant_id, s.cart_id, s.status, s.review_token_digest,
                 s.expires_at, s.order_id
          FROM conduit.ucp_checkout_sessions s`;
}

function quoteFrom(cart: PricedCart) {
  return {
    currency: cart.total.currency,
    lines: cart.lines.map((line) => ({
      productId: line.productId,
      sku: line.sku,
      quantity: line.quantity,
      unitPrice: line.unitPrice.toJSON(),
      lineTotal: line.lineTotal.toJSON(),
      priceVersion: line.priceVersion,
    })),
    statedTotal: cart.total.toJSON(),
  };
}

function invalidRequest(message = "Invalid request"): ApiResult {
  return { status: 400, body: { code: "invalid_request", content: message } };
}

function objectId(value: unknown): string {
  if (typeof value !== "object" || value === null || !("id" in value)) {
    throw new Error("Protocol response has no resource id");
  }
  return String(value.id);
}

function evidenceFrom(value: unknown): unknown {
  if (typeof value !== "object" || value === null || !("conduit_evidence" in value)) {
    throw new Error("Trusted checkout response has no order evidence");
  }
  return value.conduit_evidence;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeDigestMatch(left: string, right: string): boolean {
  return (
    left.length === right.length &&
    timingSafeEqual(Buffer.from(left), Buffer.from(right))
  );
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
