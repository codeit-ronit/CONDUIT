import {
  CommerceService,
  DeterministicModelledOrderProvider,
  ModelledPaymentProvider,
  TrustService,
} from "@conduit/application";
import {
  createAuthorizationGrantSchema,
  createBuyerSchema,
  trustedCommitSchema,
} from "@conduit/contracts";
import type { PricedCart } from "@conduit/domain";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PostgresCommerceRepository } from "../src/postgres-commerce-repository.js";
import { PostgresTrustRepository } from "../src/postgres-trust-repository.js";
import { createDatabasePool } from "../src/postgres.js";

describe("Phase 2 trust kernel", () => {
  let pool: Pool;
  let commerce: CommerceService;
  let trust: TrustService;
  let trustRepository: PostgresTrustRepository;
  let provider: ModelledPaymentProvider;

  beforeAll(() => {
    pool = createDatabasePool();
    commerce = new CommerceService(
      new PostgresCommerceRepository(pool),
      new DeterministicModelledOrderProvider(),
    );
    trustRepository = new PostgresTrustRepository(pool);
    provider = new ModelledPaymentProvider();
    trust = new TrustService(trustRepository, provider);
  });

  beforeEach(async () => {
    await pool.query(`
      TRUNCATE TABLE conduit.tenants RESTART IDENTITY CASCADE
    `);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("reserves, durably queues, confirms, and safely replays one purchase", async () => {
    const world = await createTrustWorld(commerce, trust, "happy", 100_000n);
    const input = commitInput(world, "happy-operation", quoteFrom(world.cart));
    const [first, replay] = await Promise.all([
      trust.commit(input),
      trust.commit(input),
    ]);

    expect([first.outcome, replay.outcome].sort()).toEqual([
      "PENDING_PROVIDER",
      "REPLAYED",
    ]);
    const prepared = first.outcome === "PENDING_PROVIDER" ? first : replay;
    if (prepared.outcome !== "PENDING_PROVIDER")
      throw new Error("Expected preparation");

    const durable = await pool.query<{
      readonly cart_status: string;
      readonly outbox_status: string;
      readonly reservation_status: string;
      readonly entry_type: string;
    }>(
      `SELECT c.status AS cart_status, o.status AS outbox_status,
              r.status AS reservation_status, d.entry_type
       FROM conduit.purchase_operations p
       JOIN conduit.carts c ON c.id = p.cart_id
       JOIN conduit.provider_outbox o ON o.operation_id = p.id
       JOIN conduit.inventory_reservations r ON r.operation_id = p.id
       JOIN conduit.drawdown_entries d ON d.operation_id = p.id
       WHERE p.id = $1`,
      [prepared.operation.id],
    );
    expect(durable.rows[0]).toMatchObject({
      cart_status: "COMMITTING",
      outbox_status: "PENDING",
      reservation_status: "RESERVED",
      entry_type: "RESERVE",
    });

    const confirmed = await trust.processNextProviderCommand();
    expect(confirmed).toMatchObject({ status: "CONFIRMED" });
    const counts = await pool.query<{
      readonly operations: string;
      readonly orders: string;
      readonly confirms: string;
    }>(
      `SELECT
         (SELECT COUNT(*)::text FROM conduit.purchase_operations) AS operations,
         (SELECT COUNT(*)::text FROM conduit.orders) AS orders,
         (SELECT COUNT(*)::text FROM conduit.drawdown_entries WHERE entry_type = 'CONFIRM') AS confirms`,
    );
    expect(counts.rows[0]).toEqual({ operations: "1", orders: "1", confirms: "1" });
  });

  it("uses different decisions for wrong arithmetic and a real price change", async () => {
    const arithmetic = await createTrustWorld(commerce, trust, "math", 100_000n);
    const wrong = quoteFrom(arithmetic.cart);
    const firstLine = wrong.lines[0];
    if (!firstLine) throw new Error("Expected a quoted line");
    wrong.lines[0] = {
      ...firstLine,
      lineTotal: { currency: "INR", minorUnits: "39700" },
    };
    wrong.statedTotal = { currency: "INR", minorUnits: "39700" };

    const mathResult = await trust.commit(
      commitInput(arithmetic, "wrong-math-01", wrong),
    );
    expect(mathResult).toMatchObject({
      outcome: "DENIED",
      decision: { reason: "QUOTE_ARITHMETIC_MISMATCH" },
    });

    const changed = await createTrustWorld(commerce, trust, "price", 100_000n);
    const oldQuote = quoteFrom(changed.cart);
    await commerce.changePrice({
      tenantId: changed.tenant.id,
      productId: changed.product.id,
      price: { currency: "INR", minorUnits: "22500" },
    });
    const priceResult = await trust.commit(
      commitInput(changed, "price-change-01", oldQuote),
    );
    expect(priceResult).toMatchObject({
      outcome: "REQUIRES_APPROVAL",
      decision: { reason: "PRICE_CHANGED" },
      liveQuote: { statedTotal: { minorUnits: 45_000n } },
    });
  });

  it("serializes drawdown so concurrent carts cannot overspend one grant", async () => {
    const world = await createTrustWorld(commerce, trust, "limit", 100_000n, 3);
    const secondCart = await commerce.createCart({
      tenantId: world.tenant.id,
      merchantId: world.merchant.id,
    });
    const secondPriced = await commerce.setCartLine({
      tenantId: world.tenant.id,
      cartId: secondCart.id,
      productId: world.product.id,
      quantity: 3,
    });
    const [a, b] = await Promise.all([
      trust.commit(commitInput(world, "parallel-spend-a", quoteFrom(world.cart))),
      trust.commit(
        commitInput(
          { ...world, cart: secondPriced },
          "parallel-spend-b",
          quoteFrom(secondPriced),
        ),
      ),
    ]);
    expect([a.outcome, b.outcome].sort()).toEqual(["DENIED", "PENDING_PROVIDER"]);
    const denied = a.outcome === "DENIED" ? a : b;
    expect(denied.decision.reason).toBe("AMOUNT_EXCEEDS_REMAINING");
  });

  it("keeps an ambiguous provider result UNKNOWN and reconciles by lookup", async () => {
    const world = await createTrustWorld(commerce, trust, "unknown", 100_000n);
    const prepared = await trust.commit(
      commitInput(world, "provider-unknown-01", quoteFrom(world.cart)),
    );
    if (prepared.outcome !== "PENDING_PROVIDER")
      throw new Error("Expected preparation");

    const unknown = await trust.processNextProviderCommand();
    expect(unknown?.status).toBe("PAYMENT_UNKNOWN");
    const reconciled = await trust.reconcileUnknown(prepared.operation.id);
    expect(reconciled.status).toBe("CONFIRMED");

    const outbox = await pool.query<{
      readonly status: string;
      readonly attempts: number;
    }>(`SELECT status, attempts FROM conduit.provider_outbox WHERE operation_id = $1`, [
      prepared.operation.id,
    ]);
    expect(outbox.rows[0]).toEqual({ status: "DELIVERED", attempts: 1 });
  });

  it("recovers a stale worker lease with the same provider idempotency key", async () => {
    const world = await createTrustWorld(commerce, trust, "worker-crash", 100_000n);
    const prepared = await trust.commit(
      commitInput(world, "worker-crash-01", quoteFrom(world.cart)),
    );
    if (prepared.outcome !== "PENDING_PROVIDER")
      throw new Error("Expected preparation");

    const claimedBeforeCrash = await trustRepository.claimNextProviderCommand();
    if (!claimedBeforeCrash) throw new Error("Expected outbox command");
    await provider.authorize(claimedBeforeCrash);
    // The provider acted, then the worker disappeared before completing PostgreSQL.
    await pool.query(
      `UPDATE conduit.provider_outbox
       SET locked_at = clock_timestamp() - interval '31 seconds'
       WHERE operation_id = $1`,
      [prepared.operation.id],
    );

    const recovered = await trust.processNextProviderCommand();
    expect(recovered?.status).toBe("CONFIRMED");
    const evidence = await pool.query<{
      readonly attempts: number;
      readonly operations: string;
      readonly orders: string;
    }>(
      `SELECT x.attempts,
              (SELECT COUNT(*)::text FROM conduit.purchase_operations WHERE id = $1) AS operations,
              (SELECT COUNT(*)::text FROM conduit.orders WHERE operation_id = $1) AS orders
       FROM conduit.provider_outbox x WHERE x.operation_id = $1`,
      [prepared.operation.id],
    );
    expect(evidence.rows[0]).toEqual({ attempts: 2, operations: "1", orders: "1" });
  });

  it("releases stock and spending capacity after a definite provider decline", async () => {
    const world = await createTrustWorld(commerce, trust, "decline", 100_000n);
    const prepared = await trust.commit(
      commitInput(world, "provider-decline-01", quoteFrom(world.cart)),
    );
    if (prepared.outcome !== "PENDING_PROVIDER")
      throw new Error("Expected preparation");
    const failed = await trust.processNextProviderCommand();
    expect(failed?.status).toBe("FAILED");

    const state = await pool.query<{
      readonly available_quantity: number;
      readonly cart_status: string;
      readonly entries: string[];
    }>(
      `SELECT i.available_quantity, c.status AS cart_status,
              array_agg(d.entry_type ORDER BY d.sequence) AS entries
       FROM conduit.inventory i
       JOIN conduit.carts c ON c.id = $2
       JOIN conduit.drawdown_entries d ON d.operation_id = $3
       WHERE i.product_id = $1
       GROUP BY i.available_quantity, c.status`,
      [world.product.id, world.cart.id, prepared.operation.id],
    );
    expect(state.rows[0]).toEqual({
      available_quantity: 25,
      cart_status: "OPEN",
      entries: ["RESERVE", "RELEASE"],
    });
  });
});

async function createTrustWorld(
  commerce: CommerceService,
  trust: TrustService,
  prefix: string,
  maximum: bigint,
  quantity = 2,
) {
  const tenant = await commerce.createTenant({
    slug: `${prefix}-${Date.now().toString()}-tenant`,
    displayName: `${prefix} Tenant`,
  });
  const merchant = await commerce.createMerchant({
    tenantId: tenant.id,
    slug: `${prefix}-merchant`,
    displayName: `${prefix} Merchant`,
    currency: "INR",
  });
  const product = await commerce.createProduct({
    tenantId: tenant.id,
    merchantId: merchant.id,
    sku: "PANEER-01",
    displayName: "Paneer Tikka",
    description: "Untrusted merchant prose cannot grant spending authority.",
    category: "dinner",
    attributes: { vegetarian: true },
    price: { currency: "INR", minorUnits: "19900" },
    stock: 25,
  });
  const buyer = await trust.createBuyer(
    createBuyerSchema.parse({ tenantId: tenant.id, displayName: "Demo Buyer" }),
  );
  const grant = await trust.createAuthorizationGrant(
    createAuthorizationGrantSchema.parse({
      tenantId: tenant.id,
      buyerId: buyer.id,
      merchantId: merchant.id,
      maximumAmount: { currency: "INR", minorUnits: maximum.toString() },
      allowedCategories: ["dinner"],
      allowedSkus: ["PANEER-01"],
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      policyVersion: "trust-v1",
    }),
  );
  const emptyCart = await commerce.createCart({
    tenantId: tenant.id,
    merchantId: merchant.id,
  });
  const cart = await commerce.setCartLine({
    tenantId: tenant.id,
    cartId: emptyCart.id,
    productId: product.id,
    quantity,
  });
  return { tenant, merchant, product, buyer, grant, cart };
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

function commitInput(
  world: Awaited<ReturnType<typeof createTrustWorld>>,
  operationKey: string,
  quote: ReturnType<typeof quoteFrom>,
) {
  return trustedCommitSchema.parse({
    tenantId: world.tenant.id,
    cartId: world.cart.id,
    grantId: world.grant.id,
    operationKey,
    quote,
  });
}
