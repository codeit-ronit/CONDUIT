import type {
  AuthorizationGrantId,
  BuyerId,
  CartId,
  MerchantId,
  Money,
  OrderId,
  ProductId,
  PurchaseOperationId,
  TenantId,
} from "@conduit/domain";

export type EvidenceClaimLevel = "MODELLED" | "TESTED" | "SANDBOX" | "LIVE";

export interface OrderEvidenceLine {
  readonly productId: ProductId;
  readonly sku: string;
  readonly displayName: string;
  readonly quantity: number;
  readonly priceVersion: number;
  readonly unitPrice: Money;
  readonly lineTotal: Money;
}

export interface OrderEvidenceEvent {
  readonly sequence: number;
  readonly type: string;
  readonly source: string;
  readonly occurredAt: Date;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface OrderEvidence {
  readonly schemaVersion: "conduit.order-evidence.v1";
  readonly generatedAt: Date;
  readonly claims: {
    readonly commerceState: "TESTED";
    readonly payment: EvidenceClaimLevel;
    readonly auditLink: "NOT_LINKED";
  };
  readonly order: {
    readonly id: OrderId;
    readonly tenantId: TenantId;
    readonly merchantId: MerchantId;
    readonly merchantName: string;
    readonly cartId: CartId;
    readonly status: "PENDING" | "MODELLED" | "FAILED";
    readonly createdAt: Date;
  };
  readonly operation: {
    readonly id: PurchaseOperationId;
    readonly status: "PENDING_PROVIDER" | "CONFIRMED" | "PAYMENT_UNKNOWN" | "FAILED";
    readonly decisionReason: string;
    readonly total: Money;
    readonly providerReference: string;
    readonly createdAt: Date;
    readonly updatedAt: Date;
  };
  readonly authorization: {
    readonly id: AuthorizationGrantId;
    readonly buyerId: BuyerId;
    readonly policyVersion: string;
    readonly maximumAmount: Money;
    readonly expiresAt: Date;
    readonly revokedAt: Date | null;
  };
  readonly lines: readonly OrderEvidenceLine[];
  readonly providerDelivery: {
    readonly id: string;
    readonly eventType: string;
    readonly status: "PENDING" | "PROCESSING" | "DELIVERED" | "UNKNOWN";
    readonly attempts: number;
    readonly createdAt: Date;
    readonly updatedAt: Date;
  };
  readonly drawdown: readonly {
    readonly sequence: number;
    readonly type: "RESERVE" | "CONFIRM" | "RELEASE" | "REVERSE";
    readonly amount: Money;
    readonly occurredAt: Date;
  }[];
  readonly inventory: readonly {
    readonly productId: ProductId;
    readonly quantity: number;
    readonly status: "RESERVED" | "CONFIRMED" | "RELEASED";
    readonly createdAt: Date;
    readonly updatedAt: Date;
  }[];
  readonly timeline: readonly OrderEvidenceEvent[];
}

export interface OrderEvidenceRepository {
  get(tenantId: TenantId, orderId: OrderId): Promise<OrderEvidence | null>;
}

export class OrderEvidenceService {
  public constructor(private readonly repository: OrderEvidenceRepository) {}

  public get(tenantId: TenantId, orderId: OrderId): Promise<OrderEvidence | null> {
    return this.repository.get(tenantId, orderId);
  }
}
