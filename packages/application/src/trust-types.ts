import type {
  AuthorizationGrant,
  AuthorizationGrantId,
  BuyerId,
  CartId,
  MerchantId,
  Money,
  OrderId,
  PolicyDecision,
  PurchaseOperationId,
  PurchaseQuote,
  TenantId,
} from "@conduit/domain";

export interface Buyer {
  readonly id: BuyerId;
  readonly tenantId: TenantId;
  readonly displayName: string;
}

export interface NewAuthorizationGrant {
  readonly tenantId: TenantId;
  readonly buyerId: BuyerId;
  readonly merchantId: MerchantId;
  readonly maximumAmount: Money;
  readonly allowedCategories: readonly string[];
  readonly allowedSkus: readonly string[];
  readonly expiresAt: Date;
  readonly policyVersion: "trust-v1";
}

export interface GateStep {
  readonly key:
    | "IDEMPOTENCY"
    | "CART_STATE"
    | "LIVE_REPRICE"
    | "QUOTE_ARITHMETIC"
    | "AUTHORIZATION_SCOPE"
    | "STOCK_RESERVATION"
    | "DRAWDOWN_RESERVATION"
    | "POLICY"
    | "OUTBOX";
  readonly status: "PASS" | "WARN" | "STOP";
  readonly detail: string;
}

export type PurchaseOperationStatus =
  "PENDING_PROVIDER" | "CONFIRMED" | "PAYMENT_UNKNOWN" | "FAILED";

export interface TrustedPurchaseOperation {
  readonly id: PurchaseOperationId;
  readonly tenantId: TenantId;
  readonly operationKey: string;
  readonly cartId: CartId;
  readonly grantId: AuthorizationGrantId;
  readonly orderId: OrderId;
  readonly status: PurchaseOperationStatus;
  readonly total: Money;
  readonly providerReference: string;
}

export type TrustedCommitResult =
  | {
      readonly outcome: "DENIED" | "REQUIRES_APPROVAL";
      readonly decision: PolicyDecision;
      readonly liveQuote: PurchaseQuote;
      readonly gates: readonly GateStep[];
    }
  | {
      readonly outcome: "PENDING_PROVIDER" | "REPLAYED";
      readonly decision: PolicyDecision;
      readonly operation: TrustedPurchaseOperation;
      readonly liveQuote: PurchaseQuote;
      readonly gates: readonly GateStep[];
    };

export interface PrepareTrustedCommit {
  readonly tenantId: TenantId;
  readonly cartId: CartId;
  readonly grantId: AuthorizationGrantId;
  readonly operationKey: string;
  readonly claimedQuote: PurchaseQuote;
}

export interface ProviderCommand {
  readonly outboxId: string;
  readonly operationId: PurchaseOperationId;
  readonly operationKey: string;
  readonly amount: Money;
}

export type ProviderResult =
  | { readonly outcome: "SUCCEEDED"; readonly reference: string }
  | { readonly outcome: "DECLINED"; readonly reference: string }
  | { readonly outcome: "UNKNOWN"; readonly reference: string };

export interface PaymentProvider {
  authorize(command: ProviderCommand): Promise<ProviderResult>;
  lookup(command: ProviderCommand): Promise<ProviderResult>;
}

export interface TrustRepository {
  createBuyer(tenantId: TenantId, displayName: string): Promise<Buyer>;
  createAuthorizationGrant(input: NewAuthorizationGrant): Promise<AuthorizationGrant>;
  revokeAuthorizationGrant(
    tenantId: TenantId,
    grantId: AuthorizationGrantId,
  ): Promise<AuthorizationGrant>;
  prepareTrustedCommit(input: PrepareTrustedCommit): Promise<TrustedCommitResult>;
  claimNextProviderCommand(): Promise<ProviderCommand | null>;
  findProviderCommand(operationId: PurchaseOperationId): Promise<ProviderCommand>;
  completeProviderCommand(
    command: ProviderCommand,
    result: ProviderResult,
  ): Promise<TrustedPurchaseOperation>;
  getOperation(
    tenantId: TenantId,
    operationId: PurchaseOperationId,
  ): Promise<TrustedPurchaseOperation>;
}
