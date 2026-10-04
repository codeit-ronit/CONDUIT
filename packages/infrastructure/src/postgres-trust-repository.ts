import type {
  Buyer,
  GateStep,
  NewAuthorizationGrant,
  PrepareTrustedCommit,
  ProviderCommand,
  ProviderCompletionSource,
  ProviderResult,
  TrustRepository,
  TrustedCommitResult,
  TrustedPurchaseOperation,
} from "@conduit/application";
import {
  CommerceError,
  Money,
  authorizationGrantId,
  buyerId,
  cartId,
  evaluatePurchasePolicy,
  merchantId,
  orderId,
  productId,
  purchaseOperationId,
  tenantId,
} from "@conduit/domain";
import type {
  AuthorizationGrant,
  AuthorizationGrantId,
  PurchaseOperationId,
  PurchaseQuote,
  PurchaseQuoteLine,
  TenantId,
} from "@conduit/domain";
import type { Pool, PoolClient, QueryResultRow } from "pg";

interface BuyerRow extends QueryResultRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly display_name: string;
}

interface GrantRow extends QueryResultRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly buyer_id: string;
  readonly merchant_id: string;
  readonly currency: string;
  readonly maximum_minor_units: string;
  readonly allowed_categories: string[];
  readonly allowed_skus: string[];
  readonly expires_at: Date;
  readonly revoked_at: Date | null;
  readonly policy_version: string;
}

interface TrustCartRow extends QueryResultRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly merchant_id: string;
  readonly status: "OPEN" | "COMMITTING" | "COMMITTED";
  readonly currency: string;
}

interface TrustLineRow extends QueryResultRow {
  readonly product_id: string;
  readonly sku: string;
  readonly category: string;
  readonly quantity: number;
  readonly display_name: string;
  readonly currency: string;
  readonly minor_units: string;
  readonly price_version: number;
  readonly available_quantity: number;
}

interface OperationRow extends QueryResultRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly operation_key: string;
  readonly cart_id: string;
  readonly grant_id: string;
  readonly order_id: string;
  readonly status: "PENDING_PROVIDER" | "CONFIRMED" | "PAYMENT_UNKNOWN" | "FAILED";
  readonly currency: string;
  readonly total_minor_units: string;
  readonly provider_reference: string;
}

interface CommandRow extends QueryResultRow {
  readonly outbox_id: string;
  readonly operation_id: string;
  readonly operation_key: string;
  readonly currency: string;
  readonly total_minor_units: string;
  readonly tenant_id?: string;
  readonly order_id?: string;
  readonly attempts?: number;
}

export class PostgresTrustRepository implements TrustRepository {
  public constructor(private readonly pool: Pool) {}

  public async createBuyer(
    scopedTenantId: TenantId,
    displayName: string,
  ): Promise<Buyer> {
    const result = await this.pool.query<BuyerRow>(
      `INSERT INTO conduit.buyers (tenant_id, display_name)
       SELECT id, $2 FROM conduit.tenants WHERE id = $1
       RETURNING id, tenant_id, display_name`,
      [scopedTenantId, displayName],
    );
    const row = result.rows[0];
    if (!row) throw new CommerceError("TENANT_NOT_FOUND", "Tenant does not exist");
    return {
      id: buyerId(row.id),
      tenantId: tenantId(row.tenant_id),
      displayName: row.display_name,
    };
  }

  public async createAuthorizationGrant(
    input: NewAuthorizationGrant,
  ): Promise<AuthorizationGrant> {
    const result = await this.pool.query<GrantRow>(
      `INSERT INTO conduit.authorization_grants (
         tenant_id, buyer_id, merchant_id, currency, maximum_minor_units,
         allowed_categories, allowed_skus, expires_at, policy_version
       )
       SELECT b.tenant_id, b.id, m.id, $4, $5, $6, $7, $8, $9
       FROM conduit.buyers b
       JOIN conduit.merchants m ON m.tenant_id = b.tenant_id
       WHERE b.tenant_id = $1 AND b.id = $2 AND m.id = $3 AND m.currency = $4
       RETURNING *`,
      [
        input.tenantId,
        input.buyerId,
        input.merchantId,
        input.maximumAmount.currency,
        input.maximumAmount.minorUnits.toString(),
        input.allowedCategories,
        input.allowedSkus,
        input.expiresAt,
        input.policyVersion,
      ],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error("Buyer, merchant, tenant, and currency must belong to one scope");
    }
    return mapGrant(row);
  }

  public async revokeAuthorizationGrant(
    scopedTenantId: TenantId,
    scopedGrantId: AuthorizationGrantId,
  ): Promise<AuthorizationGrant> {
    const result = await this.pool.query<GrantRow>(
      `UPDATE conduit.authorization_grants
       SET revoked_at = COALESCE(revoked_at, clock_timestamp())
       WHERE tenant_id = $1 AND id = $2
       RETURNING *`,
      [scopedTenantId, scopedGrantId],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Authorization grant does not exist");
    return mapGrant(row);
  }

  public async prepareTrustedCommit(
    input: PrepareTrustedCommit,
  ): Promise<TrustedCommitResult> {
    return this.transaction(async (client) => {
      const cartResult = await client.query<TrustCartRow>(
        `SELECT c.id, c.tenant_id, c.merchant_id, c.status, m.currency
         FROM conduit.carts c
         JOIN conduit.merchants m ON m.tenant_id = c.tenant_id AND m.id = c.merchant_id
         WHERE c.tenant_id = $1 AND c.id = $2
         FOR UPDATE OF c`,
        [input.tenantId, input.cartId],
      );
      const cart = cartResult.rows[0];
      if (!cart) throw new CommerceError("CART_NOT_FOUND", "Cart does not exist");

      const existing = await this.findOperationByKey(
        client,
        input.tenantId,
        input.operationKey,
      );
      if (existing) {
        if (existing.cartId !== input.cartId || existing.grantId !== input.grantId) {
          throw new Error("An operation key cannot be reused for another purchase");
        }
        const liveQuote = await this.loadLiveQuote(client, cart, false);
        return {
          outcome: "REPLAYED",
          decision: allowedDecision(),
          operation: existing,
          liveQuote,
          gates: replayGates(existing.status),
        };
      }
      if (cart.status !== "OPEN") {
        throw new CommerceError("CART_NOT_OPEN", "Cart is already being processed");
      }

      const liveQuote = await this.loadLiveQuote(client, cart, true);
      if (liveQuote.lines.length === 0) {
        throw new CommerceError("EMPTY_CART", "Cart has no products");
      }
      const grantResult = await client.query<GrantRow>(
        `SELECT * FROM conduit.authorization_grants
         WHERE tenant_id = $1 AND id = $2
         FOR UPDATE`,
        [input.tenantId, input.grantId],
      );
      const grantRow = grantResult.rows[0];
      if (!grantRow)
        throw new Error("Authorization grant does not exist in this tenant");
      const grant = mapGrant(grantRow);
      const exposureResult = await client.query<{ readonly exposure: string }>(
        `SELECT COALESCE(SUM(CASE
           WHEN entry_type = 'RESERVE' THEN minor_units
           WHEN entry_type IN ('RELEASE', 'REVERSE') THEN -minor_units
           ELSE 0 END), 0)::text AS exposure
         FROM conduit.drawdown_entries
         WHERE tenant_id = $1 AND grant_id = $2`,
        [input.tenantId, input.grantId],
      );
      const exposure = Money.fromMinorUnits(
        grant.maximumAmount.currency,
        BigInt(exposureResult.rows[0]?.exposure ?? "0"),
      );
      const decision = evaluatePurchasePolicy({
        now: new Date(),
        tenantId: input.tenantId,
        merchantId: merchantId(cart.merchant_id),
        grant,
        claimedQuote: input.claimedQuote,
        liveQuote,
        existingExposure: exposure,
      });
      const gates = decisionGates(decision, liveQuote);
      if (decision.outcome !== "ALLOW") {
        return {
          outcome: decision.outcome === "DENY" ? "DENIED" : "REQUIRES_APPROVAL",
          decision,
          liveQuote,
          gates,
        };
      }

      const lineRows = await this.loadLiveLineRows(client, cart, true);
      for (const row of lineRows) {
        if (row.available_quantity < row.quantity) {
          throw new CommerceError(
            "OUT_OF_STOCK",
            `${row.sku} has ${String(row.available_quantity)} available; ${String(row.quantity)} requested`,
          );
        }
      }

      const operationResult = await client.query<{ readonly id: string }>(
        `INSERT INTO conduit.purchase_operations (
           tenant_id, operation_key, cart_id, grant_id, status, decision_reason,
           currency, total_minor_units, provider_reference
         ) VALUES ($1, $2, $3, $4, 'PENDING_PROVIDER', $5, $6, $7, $8)
         RETURNING id`,
        [
          input.tenantId,
          input.operationKey,
          input.cartId,
          input.grantId,
          decision.reason,
          liveQuote.currency,
          liveQuote.statedTotal.minorUnits.toString(),
          `modelled:${input.operationKey}`,
        ],
      );
      const operationId = purchaseOperationId(required(operationResult.rows[0]).id);

      for (const row of lineRows) {
        const stock = await client.query(
          `UPDATE conduit.inventory
           SET available_quantity = available_quantity - $3,
               version = version + 1, updated_at = clock_timestamp()
           WHERE tenant_id = $1 AND product_id = $2 AND available_quantity >= $3`,
          [input.tenantId, row.product_id, row.quantity],
        );
        if (stock.rowCount !== 1) {
          throw new CommerceError("OUT_OF_STOCK", `${row.sku} is out of stock`);
        }
        await client.query(
          `INSERT INTO conduit.inventory_reservations (
             operation_id, tenant_id, product_id, quantity, status
           ) VALUES ($1, $2, $3, $4, 'RESERVED')`,
          [operationId, input.tenantId, row.product_id, row.quantity],
        );
      }

      await client.query(
        `INSERT INTO conduit.drawdown_entries (
           tenant_id, grant_id, operation_id, entry_type, currency, minor_units
         ) VALUES ($1, $2, $3, 'RESERVE', $4, $5)`,
        [
          input.tenantId,
          input.grantId,
          operationId,
          liveQuote.currency,
          liveQuote.statedTotal.minorUnits.toString(),
        ],
      );

      const orderResult = await client.query<{ readonly id: string }>(
        `INSERT INTO conduit.orders (
           tenant_id, merchant_id, cart_id, status, provider_reference,
           currency, total_minor_units, operation_id
         ) VALUES ($1, $2, $3, 'PENDING', $4, $5, $6, $7)
         RETURNING id`,
        [
          input.tenantId,
          cart.merchant_id,
          input.cartId,
          `modelled:${input.operationKey}`,
          liveQuote.currency,
          liveQuote.statedTotal.minorUnits.toString(),
          operationId,
        ],
      );
      const createdOrderId = orderId(required(orderResult.rows[0]).id);
      for (const row of lineRows) {
        const unit = BigInt(row.minor_units);
        await client.query(
          `INSERT INTO conduit.order_lines (
             order_id, product_id, sku, display_name, quantity, price_version,
             currency, unit_minor_units, line_minor_units
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            createdOrderId,
            row.product_id,
            row.sku,
            row.display_name,
            row.quantity,
            row.price_version,
            row.currency,
            row.minor_units,
            (unit * BigInt(row.quantity)).toString(),
          ],
        );
      }
      await client.query(
        `UPDATE conduit.carts SET status = 'COMMITTING'
         WHERE tenant_id = $1 AND id = $2`,
        [input.tenantId, input.cartId],
      );
      await client.query(
        `INSERT INTO conduit.provider_outbox (
           tenant_id, operation_id, event_type, status
         ) VALUES ($1, $2, 'AUTHORIZE_PAYMENT', 'PENDING')`,
        [input.tenantId, operationId],
      );
      await appendOrderEvent(client, {
        tenantId: input.tenantId,
        orderId: createdOrderId,
        operationId,
        eventKey: `${operationId}:order-prepared`,
        eventType: "ORDER_PREPARED",
        source: "TRUST_KERNEL",
        payload: {
          currency: liveQuote.currency,
          totalMinorUnits: liveQuote.statedTotal.minorUnits.toString(),
          lineCount: lineRows.length,
        },
      });
      await appendOrderEvent(client, {
        tenantId: input.tenantId,
        orderId: createdOrderId,
        operationId,
        eventKey: `${operationId}:spend-reserved`,
        eventType: "SPEND_RESERVED",
        source: "TRUST_KERNEL",
        payload: {
          grantId: input.grantId,
          currency: liveQuote.currency,
          minorUnits: liveQuote.statedTotal.minorUnits.toString(),
        },
      });
      await appendOrderEvent(client, {
        tenantId: input.tenantId,
        orderId: createdOrderId,
        operationId,
        eventKey: `${operationId}:provider-queued`,
        eventType: "PROVIDER_QUEUED",
        source: "TRUST_KERNEL",
        payload: { eventType: "AUTHORIZE_PAYMENT" },
      });

      return {
        outcome: "PENDING_PROVIDER",
        decision,
        operation: {
          id: operationId,
          tenantId: input.tenantId,
          operationKey: input.operationKey,
          cartId: input.cartId,
          grantId: input.grantId,
          orderId: createdOrderId,
          status: "PENDING_PROVIDER",
          total: liveQuote.statedTotal,
          providerReference: `modelled:${input.operationKey}`,
        },
        liveQuote,
        gates: [
          ...gates,
          {
            key: "STOCK_RESERVATION",
            status: "PASS",
            detail: "Stock is held for this operation.",
          },
          {
            key: "DRAWDOWN_RESERVATION",
            status: "PASS",
            detail: "Spending capacity is held in the append-only ledger.",
          },
          {
            key: "OUTBOX",
            status: "PASS",
            detail: "Provider work is durable and safe to resume after a crash.",
          },
        ],
      };
    });
  }

  public async claimNextProviderCommand(): Promise<ProviderCommand | null> {
    return this.transaction(async (client) => {
      const result = await client.query<CommandRow>(
        `WITH next AS (
           SELECT o.id
           FROM conduit.provider_outbox o
           WHERE o.status = 'PENDING'
              OR (o.status = 'PROCESSING'
                  AND o.locked_at < clock_timestamp() - interval '30 seconds')
           ORDER BY o.created_at
           FOR UPDATE SKIP LOCKED
           LIMIT 1
         )
         UPDATE conduit.provider_outbox o
         SET status = 'PROCESSING', attempts = attempts + 1,
             locked_at = clock_timestamp(), updated_at = clock_timestamp()
         FROM next, conduit.purchase_operations p
         WHERE o.id = next.id AND p.id = o.operation_id
         RETURNING o.id AS outbox_id, p.id AS operation_id,
                   p.operation_key, p.currency, p.total_minor_units,
                   p.tenant_id, o.attempts,
                   (SELECT id FROM conduit.orders WHERE operation_id = p.id) AS order_id`,
      );
      const row = result.rows[0];
      if (!row) return null;
      if (!row.tenant_id || !row.order_id || row.attempts === undefined) {
        throw new Error("Claimed provider command is missing evidence identity");
      }
      await appendOrderEvent(client, {
        tenantId: row.tenant_id,
        orderId: row.order_id,
        operationId: row.operation_id,
        eventKey: `${row.outbox_id}:attempt:${String(row.attempts)}`,
        eventType: "PROVIDER_ATTEMPTED",
        source: "PROVIDER_WORKER",
        payload: { attempt: row.attempts, eventType: "AUTHORIZE_PAYMENT" },
      });
      return mapCommand(row);
    });
  }

  public async findProviderCommand(
    scopedOperationId: PurchaseOperationId,
  ): Promise<ProviderCommand> {
    const result = await this.pool.query<CommandRow>(
      `SELECT o.id AS outbox_id, p.id AS operation_id, p.operation_key,
              p.currency, p.total_minor_units
       FROM conduit.provider_outbox o
       JOIN conduit.purchase_operations p ON p.id = o.operation_id
       WHERE p.id = $1 AND o.status = 'UNKNOWN'`,
      [scopedOperationId],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Operation is not awaiting reconciliation");
    return mapCommand(row);
  }

  public async completeProviderCommand(
    command: ProviderCommand,
    result: ProviderResult,
    source: ProviderCompletionSource,
  ): Promise<TrustedPurchaseOperation> {
    return this.transaction(async (client) => {
      const current = await this.getOperationWithClient(
        client,
        command.operationId,
        true,
      );
      if (current.status === "CONFIRMED" || current.status === "FAILED") return current;

      await client.query(
        `UPDATE conduit.purchase_operations
         SET provider_reference = $2, updated_at = clock_timestamp()
         WHERE id = $1`,
        [command.operationId, result.reference],
      );
      await client.query(
        `UPDATE conduit.orders SET provider_reference = $2
         WHERE operation_id = $1`,
        [command.operationId, result.reference],
      );

      if (result.outcome === "UNKNOWN") {
        await client.query(
          `UPDATE conduit.purchase_operations
           SET status = 'PAYMENT_UNKNOWN', updated_at = clock_timestamp()
           WHERE id = $1`,
          [command.operationId],
        );
        await client.query(
          `UPDATE conduit.provider_outbox
           SET status = 'UNKNOWN', updated_at = clock_timestamp()
           WHERE id = $1`,
          [command.outboxId],
        );
        await appendOrderEventForOperation(client, command.operationId, {
          eventKey: `${command.operationId}:payment-unknown:${source.toLowerCase()}`,
          eventType: "PAYMENT_UNKNOWN",
          source: source === "AUTHORIZE" ? "PROVIDER_WORKER" : "RECONCILIATION",
          payload: { providerReference: result.reference },
        });
        return this.getOperationWithClient(client, command.operationId, false);
      }

      if (result.outcome === "SUCCEEDED") {
        await client.query(
          `INSERT INTO conduit.drawdown_entries (
             tenant_id, grant_id, operation_id, entry_type, currency, minor_units
           )
           SELECT tenant_id, grant_id, id, 'CONFIRM', currency, total_minor_units
           FROM conduit.purchase_operations WHERE id = $1
           ON CONFLICT (operation_id, entry_type) DO NOTHING`,
          [command.operationId],
        );
        await client.query(
          `UPDATE conduit.inventory_reservations
           SET status = 'CONFIRMED', updated_at = clock_timestamp()
           WHERE operation_id = $1 AND status = 'RESERVED'`,
          [command.operationId],
        );
        await client.query(
          `UPDATE conduit.purchase_operations
           SET status = 'CONFIRMED', updated_at = clock_timestamp() WHERE id = $1`,
          [command.operationId],
        );
        await client.query(
          `UPDATE conduit.orders SET status = 'MODELLED' WHERE operation_id = $1`,
          [command.operationId],
        );
        await client.query(
          `UPDATE conduit.carts SET status = 'COMMITTED', committed_at = clock_timestamp()
           WHERE id = $1`,
          [current.cartId],
        );
      } else {
        const released = await client.query<{
          readonly product_id: string;
          readonly quantity: number;
        }>(
          `UPDATE conduit.inventory_reservations
           SET status = 'RELEASED', updated_at = clock_timestamp()
           WHERE operation_id = $1 AND status = 'RESERVED'
           RETURNING product_id, quantity`,
          [command.operationId],
        );
        for (const reservation of released.rows) {
          await client.query(
            `UPDATE conduit.inventory
             SET available_quantity = available_quantity + $2,
                 version = version + 1, updated_at = clock_timestamp()
             WHERE product_id = $1`,
            [reservation.product_id, reservation.quantity],
          );
        }
        await client.query(
          `INSERT INTO conduit.drawdown_entries (
             tenant_id, grant_id, operation_id, entry_type, currency, minor_units
           )
           SELECT tenant_id, grant_id, id, 'RELEASE', currency, total_minor_units
           FROM conduit.purchase_operations WHERE id = $1
           ON CONFLICT (operation_id, entry_type) DO NOTHING`,
          [command.operationId],
        );
        await client.query(
          `UPDATE conduit.purchase_operations
           SET status = 'FAILED', updated_at = clock_timestamp() WHERE id = $1`,
          [command.operationId],
        );
        await client.query(
          `UPDATE conduit.orders SET status = 'FAILED' WHERE operation_id = $1`,
          [command.operationId],
        );
        await client.query(`UPDATE conduit.carts SET status = 'OPEN' WHERE id = $1`, [
          current.cartId,
        ]);
      }

      await client.query(
        `UPDATE conduit.provider_outbox
         SET status = 'DELIVERED', updated_at = clock_timestamp() WHERE id = $1`,
        [command.outboxId],
      );
      await appendOrderEventForOperation(client, command.operationId, {
        eventKey: `${command.operationId}:payment-${result.outcome.toLowerCase()}:${source.toLowerCase()}`,
        eventType:
          result.outcome === "SUCCEEDED" ? "PAYMENT_CONFIRMED" : "PAYMENT_DECLINED",
        source: source === "AUTHORIZE" ? "PROVIDER_WORKER" : "RECONCILIATION",
        payload: { providerReference: result.reference },
      });
      return this.getOperationWithClient(client, command.operationId, false);
    });
  }

  public async getOperation(
    scopedTenantId: TenantId,
    scopedOperationId: PurchaseOperationId,
  ): Promise<TrustedPurchaseOperation> {
    const client = await this.pool.connect();
    try {
      const operation = await this.getOperationWithClient(
        client,
        scopedOperationId,
        false,
      );
      if (operation.tenantId !== scopedTenantId)
        throw new Error("Operation does not exist");
      return operation;
    } finally {
      client.release();
    }
  }

  private async loadLiveQuote(
    client: PoolClient,
    cart: TrustCartRow,
    lockInventory: boolean,
  ): Promise<PurchaseQuote> {
    const rows = await this.loadLiveLineRows(client, cart, lockInventory);
    const lines = rows.map(mapLiveLine);
    const total = lines.reduce(
      (sum, line) => sum.add(line.lineTotal),
      Money.fromMinorUnits(cart.currency, 0n),
    );
    return { currency: cart.currency, lines, statedTotal: total };
  }

  private async loadLiveLineRows(
    client: PoolClient,
    cart: TrustCartRow,
    lockInventory: boolean,
  ): Promise<readonly TrustLineRow[]> {
    const result = await client.query<TrustLineRow>(
      `SELECT p.id AS product_id, p.sku, p.category, p.display_name, cl.quantity,
              pp.currency, pp.minor_units, pp.version AS price_version,
              i.available_quantity
       FROM conduit.cart_lines cl
       JOIN conduit.products p ON p.tenant_id = cl.tenant_id AND p.id = cl.product_id
       JOIN conduit.product_prices pp
         ON pp.tenant_id = p.tenant_id AND pp.product_id = p.id AND pp.valid_to IS NULL
       JOIN conduit.inventory i ON i.tenant_id = p.tenant_id AND i.product_id = p.id
       WHERE cl.tenant_id = $1 AND cl.cart_id = $2
       ORDER BY p.sku${lockInventory ? " FOR UPDATE OF i" : ""}`,
      [cart.tenant_id, cart.id],
    );
    return result.rows;
  }

  private async findOperationByKey(
    client: PoolClient,
    scopedTenantId: TenantId,
    operationKey: string,
  ): Promise<TrustedPurchaseOperation | null> {
    const result = await client.query<OperationRow>(
      `${operationSelect()} WHERE p.tenant_id = $1 AND p.operation_key = $2`,
      [scopedTenantId, operationKey],
    );
    return result.rows[0] ? mapOperation(result.rows[0]) : null;
  }

  private async getOperationWithClient(
    client: PoolClient,
    scopedOperationId: PurchaseOperationId,
    lock: boolean,
  ): Promise<TrustedPurchaseOperation> {
    const result = await client.query<OperationRow>(
      `${operationSelect()} WHERE p.id = $1${lock ? " FOR UPDATE OF p" : ""}`,
      [scopedOperationId],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Purchase operation does not exist");
    return mapOperation(row);
  }

  private async transaction<TResult>(
    operation: (client: PoolClient) => Promise<TResult>,
  ): Promise<TResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error: unknown) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

interface NewOrderEvidenceEvent {
  readonly tenantId: string;
  readonly orderId: string;
  readonly operationId: string;
  readonly eventKey: string;
  readonly eventType: string;
  readonly source: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

async function appendOrderEvent(
  client: PoolClient,
  event: NewOrderEvidenceEvent,
): Promise<void> {
  await client.query(
    `INSERT INTO conduit.order_evidence_events (
       tenant_id, order_id, operation_id, event_key, event_type, source, payload
     ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
     ON CONFLICT (tenant_id, event_key) DO NOTHING`,
    [
      event.tenantId,
      event.orderId,
      event.operationId,
      event.eventKey,
      event.eventType,
      event.source,
      JSON.stringify(event.payload),
    ],
  );
}

async function appendOrderEventForOperation(
  client: PoolClient,
  operationId: PurchaseOperationId,
  event: Omit<NewOrderEvidenceEvent, "tenantId" | "orderId" | "operationId">,
): Promise<void> {
  const identity = await client.query<{
    readonly tenant_id: string;
    readonly order_id: string;
  }>(
    `SELECT p.tenant_id, o.id AS order_id
     FROM conduit.purchase_operations p
     JOIN conduit.orders o ON o.operation_id = p.id
     WHERE p.id = $1`,
    [operationId],
  );
  const row = identity.rows[0];
  if (!row) throw new Error("Operation has no order evidence identity");
  await appendOrderEvent(client, {
    ...event,
    tenantId: row.tenant_id,
    orderId: row.order_id,
    operationId,
  });
}

function mapGrant(row: GrantRow): AuthorizationGrant {
  return {
    id: authorizationGrantId(row.id),
    tenantId: tenantId(row.tenant_id),
    buyerId: buyerId(row.buyer_id),
    merchantId: merchantId(row.merchant_id),
    maximumAmount: Money.fromMinorUnits(row.currency, BigInt(row.maximum_minor_units)),
    allowedCategories: row.allowed_categories,
    allowedSkus: row.allowed_skus,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    policyVersion: row.policy_version,
  };
}

function mapLiveLine(row: TrustLineRow): PurchaseQuoteLine {
  const unitPrice = Money.fromMinorUnits(row.currency, BigInt(row.minor_units));
  return {
    productId: productId(row.product_id),
    sku: row.sku,
    category: row.category,
    quantity: row.quantity,
    unitPrice,
    lineTotal: unitPrice.multiply(BigInt(row.quantity)),
    priceVersion: row.price_version,
  };
}

function operationSelect(): string {
  return `SELECT p.id, p.tenant_id, p.operation_key, p.cart_id, p.grant_id,
                 o.id AS order_id, p.status, p.currency, p.total_minor_units,
                 p.provider_reference
          FROM conduit.purchase_operations p
          JOIN conduit.orders o ON o.operation_id = p.id`;
}

function mapOperation(row: OperationRow): TrustedPurchaseOperation {
  return {
    id: purchaseOperationId(row.id),
    tenantId: tenantId(row.tenant_id),
    operationKey: row.operation_key,
    cartId: cartId(row.cart_id),
    grantId: authorizationGrantId(row.grant_id),
    orderId: orderId(row.order_id),
    status: row.status,
    total: Money.fromMinorUnits(row.currency, BigInt(row.total_minor_units)),
    providerReference: row.provider_reference,
  };
}

function mapCommand(row: CommandRow): ProviderCommand {
  return {
    outboxId: row.outbox_id,
    operationId: purchaseOperationId(row.operation_id),
    operationKey: row.operation_key,
    amount: Money.fromMinorUnits(row.currency, BigInt(row.total_minor_units)),
  };
}

function allowedDecision() {
  return {
    outcome: "ALLOW" as const,
    reason: "AUTHORIZED" as const,
    explanation:
      "The original trusted decision is being replayed without a new effect.",
    recoveryAction: null,
  };
}

function decisionGates(
  decision: ReturnType<typeof evaluatePurchasePolicy>,
  liveQuote: PurchaseQuote,
): readonly GateStep[] {
  const stoppedAtArithmetic = decision.reason === "QUOTE_ARITHMETIC_MISMATCH";
  const priceChanged = decision.reason === "PRICE_CHANGED";
  return [
    {
      key: "IDEMPOTENCY",
      status: "PASS",
      detail: "Operation key is new for this tenant.",
    },
    { key: "CART_STATE", status: "PASS", detail: "Cart is open and has line items." },
    {
      key: "LIVE_REPRICE",
      status: priceChanged ? "WARN" : "PASS",
      detail: `Server total is ${liveQuote.statedTotal.minorUnits.toString()} ${liveQuote.currency} minor units.`,
    },
    {
      key: "QUOTE_ARITHMETIC",
      status: stoppedAtArithmetic ? "STOP" : "PASS",
      detail: stoppedAtArithmetic
        ? decision.explanation
        : "Claimed line arithmetic is exact.",
    },
    {
      key: "AUTHORIZATION_SCOPE",
      status:
        decision.outcome === "DENY" && !stoppedAtArithmetic
          ? "STOP"
          : priceChanged
            ? "PASS"
            : "PASS",
      detail:
        decision.outcome === "DENY" && !stoppedAtArithmetic
          ? decision.explanation
          : "Tenant, merchant, currency, item scope, time, and amount were checked.",
    },
    {
      key: "POLICY",
      status:
        decision.outcome === "ALLOW"
          ? "PASS"
          : decision.outcome === "DENY"
            ? "STOP"
            : "WARN",
      detail: decision.explanation,
    },
  ];
}

function replayGates(status: TrustedPurchaseOperation["status"]): readonly GateStep[] {
  return [
    {
      key: "IDEMPOTENCY",
      status: "PASS",
      detail: `Existing operation returned in ${status}; no second provider effect was created.`,
    },
  ];
}

function required<T>(row: T | undefined): T {
  if (!row) throw new Error("PostgreSQL returned no row");
  return row;
}
