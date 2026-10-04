import type { OrderEvidence, OrderEvidenceRepository } from "@conduit/application";
import {
  Money,
  authorizationGrantId,
  buyerId,
  cartId,
  merchantId,
  orderId,
  productId,
  purchaseOperationId,
  tenantId,
} from "@conduit/domain";
import type { OrderId, TenantId } from "@conduit/domain";
import type { Pool, QueryResultRow } from "pg";

interface RootRow extends QueryResultRow {
  readonly order_id: string;
  readonly tenant_id: string;
  readonly merchant_id: string;
  readonly merchant_name: string;
  readonly cart_id: string;
  readonly order_status: "PENDING" | "MODELLED" | "FAILED";
  readonly order_created_at: Date;
  readonly operation_id: string;
  readonly operation_status:
    "PENDING_PROVIDER" | "CONFIRMED" | "PAYMENT_UNKNOWN" | "FAILED";
  readonly decision_reason: string;
  readonly currency: string;
  readonly total_minor_units: string;
  readonly provider_reference: string;
  readonly operation_created_at: Date;
  readonly operation_updated_at: Date;
  readonly grant_id: string;
  readonly buyer_id: string;
  readonly policy_version: string;
  readonly grant_currency: string;
  readonly maximum_minor_units: string;
  readonly expires_at: Date;
  readonly revoked_at: Date | null;
  readonly outbox_id: string;
  readonly outbox_event_type: string;
  readonly outbox_status: "PENDING" | "PROCESSING" | "DELIVERED" | "UNKNOWN";
  readonly attempts: number;
  readonly outbox_created_at: Date;
  readonly outbox_updated_at: Date;
}

interface LineRow extends QueryResultRow {
  readonly product_id: string;
  readonly sku: string;
  readonly display_name: string;
  readonly quantity: number;
  readonly price_version: number;
  readonly currency: string;
  readonly unit_minor_units: string;
  readonly line_minor_units: string;
}

interface DrawdownRow extends QueryResultRow {
  readonly sequence: string;
  readonly entry_type: "RESERVE" | "CONFIRM" | "RELEASE" | "REVERSE";
  readonly currency: string;
  readonly minor_units: string;
  readonly created_at: Date;
}

interface InventoryRow extends QueryResultRow {
  readonly product_id: string;
  readonly quantity: number;
  readonly status: "RESERVED" | "CONFIRMED" | "RELEASED";
  readonly created_at: Date;
  readonly updated_at: Date;
}

interface EventRow extends QueryResultRow {
  readonly sequence: string;
  readonly event_type: string;
  readonly source: string;
  readonly payload: unknown;
  readonly occurred_at: Date;
}

export class PostgresOrderEvidenceRepository implements OrderEvidenceRepository {
  public constructor(private readonly pool: Pool) {}

  public async get(
    scopedTenantId: TenantId,
    scopedOrderId: OrderId,
  ): Promise<OrderEvidence | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const rootResult = await client.query<RootRow>(
        `SELECT o.id AS order_id, o.tenant_id, o.merchant_id,
                m.display_name AS merchant_name, o.cart_id,
                o.status AS order_status, o.created_at AS order_created_at,
                p.id AS operation_id, p.status AS operation_status,
                p.decision_reason, p.currency, p.total_minor_units,
                p.provider_reference, p.created_at AS operation_created_at,
                p.updated_at AS operation_updated_at,
                g.id AS grant_id, g.buyer_id, g.policy_version,
                g.currency AS grant_currency, g.maximum_minor_units,
                g.expires_at, g.revoked_at,
                x.id AS outbox_id, x.event_type AS outbox_event_type,
                x.status AS outbox_status, x.attempts,
                x.created_at AS outbox_created_at,
                x.updated_at AS outbox_updated_at
         FROM conduit.orders o
         JOIN conduit.merchants m
           ON m.tenant_id = o.tenant_id AND m.id = o.merchant_id
         JOIN conduit.purchase_operations p
           ON p.tenant_id = o.tenant_id AND p.id = o.operation_id
         JOIN conduit.authorization_grants g
           ON g.tenant_id = p.tenant_id AND g.id = p.grant_id
         JOIN conduit.provider_outbox x
           ON x.tenant_id = p.tenant_id AND x.operation_id = p.id
         WHERE o.tenant_id = $1 AND o.id = $2`,
        [scopedTenantId, scopedOrderId],
      );
      const root = rootResult.rows[0];
      if (!root) {
        await client.query("COMMIT");
        return null;
      }

      const lines = await client.query<LineRow>(
        `SELECT product_id, sku, display_name, quantity, price_version,
                currency, unit_minor_units, line_minor_units
         FROM conduit.order_lines WHERE order_id = $1 ORDER BY sku, product_id`,
        [root.order_id],
      );
      const drawdown = await client.query<DrawdownRow>(
        `SELECT sequence, entry_type, currency, minor_units, created_at
         FROM conduit.drawdown_entries
         WHERE tenant_id = $1 AND operation_id = $2 ORDER BY sequence`,
        [root.tenant_id, root.operation_id],
      );
      const inventory = await client.query<InventoryRow>(
        `SELECT product_id, quantity, status, created_at, updated_at
         FROM conduit.inventory_reservations
         WHERE tenant_id = $1 AND operation_id = $2 ORDER BY product_id`,
        [root.tenant_id, root.operation_id],
      );
      const timeline = await client.query<EventRow>(
        `SELECT sequence, event_type, source, payload, occurred_at
         FROM conduit.order_evidence_events
         WHERE tenant_id = $1 AND order_id = $2 ORDER BY sequence`,
        [root.tenant_id, root.order_id],
      );
      await client.query("COMMIT");

      return {
        schemaVersion: "conduit.order-evidence.v1",
        generatedAt: new Date(),
        claims: {
          commerceState: "TESTED",
          payment: root.provider_reference.startsWith("modelled:")
            ? "MODELLED"
            : "SANDBOX",
          auditLink: "NOT_LINKED",
        },
        order: {
          id: orderId(root.order_id),
          tenantId: tenantId(root.tenant_id),
          merchantId: merchantId(root.merchant_id),
          merchantName: root.merchant_name,
          cartId: cartId(root.cart_id),
          status: root.order_status,
          createdAt: root.order_created_at,
        },
        operation: {
          id: purchaseOperationId(root.operation_id),
          status: root.operation_status,
          decisionReason: root.decision_reason,
          total: Money.fromMinorUnits(root.currency, BigInt(root.total_minor_units)),
          providerReference: root.provider_reference,
          createdAt: root.operation_created_at,
          updatedAt: root.operation_updated_at,
        },
        authorization: {
          id: authorizationGrantId(root.grant_id),
          buyerId: buyerId(root.buyer_id),
          policyVersion: root.policy_version,
          maximumAmount: Money.fromMinorUnits(
            root.grant_currency,
            BigInt(root.maximum_minor_units),
          ),
          expiresAt: root.expires_at,
          revokedAt: root.revoked_at,
        },
        lines: lines.rows.map((line) => ({
          productId: productId(line.product_id),
          sku: line.sku,
          displayName: line.display_name,
          quantity: line.quantity,
          priceVersion: line.price_version,
          unitPrice: Money.fromMinorUnits(line.currency, BigInt(line.unit_minor_units)),
          lineTotal: Money.fromMinorUnits(line.currency, BigInt(line.line_minor_units)),
        })),
        providerDelivery: {
          id: root.outbox_id,
          eventType: root.outbox_event_type,
          status: root.outbox_status,
          attempts: root.attempts,
          createdAt: root.outbox_created_at,
          updatedAt: root.outbox_updated_at,
        },
        drawdown: drawdown.rows.map((entry) => ({
          sequence: safeNumber(entry.sequence, "drawdown sequence"),
          type: entry.entry_type,
          amount: Money.fromMinorUnits(entry.currency, BigInt(entry.minor_units)),
          occurredAt: entry.created_at,
        })),
        inventory: inventory.rows.map((reservation) => ({
          productId: productId(reservation.product_id),
          quantity: reservation.quantity,
          status: reservation.status,
          createdAt: reservation.created_at,
          updatedAt: reservation.updated_at,
        })),
        timeline: timeline.rows.map((event) => ({
          sequence: safeNumber(event.sequence, "order evidence sequence"),
          type: event.event_type,
          source: event.source,
          occurredAt: event.occurred_at,
          payload: objectPayload(event.payload),
        })),
      };
    } catch (error: unknown) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

function safeNumber(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${label} exceeds safe range`);
  return parsed;
}

function objectPayload(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Order evidence payload must be an object");
  }
  return value as Readonly<Record<string, unknown>>;
}
