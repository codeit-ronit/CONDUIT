import type { BuyerAction, ShoppingIntentProposal } from "@conduit/contracts";
import type { JsonValue } from "@conduit/observability";

export type AgentClaimLevel = "SCRIPTED" | "DELIBERATELY_FLAWED" | "LIVE_MODEL";

export interface IntentRequest {
  readonly request: string;
  readonly merchantId: string;
  readonly currency: string;
  readonly defaultMaximumMinorUnits: string;
}

export interface CandidateProduct {
  readonly productId: string;
  readonly sku: string;
  readonly category: string;
  readonly attributes: Readonly<Record<string, string | boolean | readonly string[]>>;
  readonly unitPriceMinorUnits: string;
  readonly availableQuantity: number;
}

export interface CartView {
  readonly cartId: string;
  readonly currency: string;
  readonly totalMinorUnits: string;
  readonly lines: readonly {
    readonly productId: string;
    readonly sku: string;
    readonly quantity: number;
    readonly unitPriceMinorUnits: string;
    readonly lineTotalMinorUnits: string;
  }[];
}

export interface ModelTurnContext {
  readonly intent: ShoppingIntentProposal;
  readonly candidates: readonly CandidateProduct[];
  readonly cart: CartView | null;
  readonly previousActions: readonly BuyerAction[];
  readonly remainingSteps: number;
}

export interface BuyerModel {
  readonly id: string;
  readonly claimLevel: AgentClaimLevel;
  proposeIntent(input: IntentRequest): Promise<unknown>;
  nextAction(context: ModelTurnContext): Promise<unknown>;
}

export interface CatalogToolResult {
  readonly products: readonly CandidateProduct[];
  readonly untrustedTextObserved: boolean;
}

export type CommitToolResult =
  | {
      readonly outcome: "CONFIRMED";
      readonly chargedMinorUnits: string;
      readonly evidence: JsonValue;
    }
  | {
      readonly outcome: "DENIED" | "REQUIRES_APPROVAL";
      readonly reason: string;
      readonly recoveryAction: string;
      readonly evidence: JsonValue;
    };

export interface BuyerTools {
  searchCatalog(category: string): Promise<CatalogToolResult>;
  setCartLine(productId: string, quantity: number): Promise<CartView>;
  reviewCart(): Promise<CartView>;
  commit(
    statedTotalMinorUnits: string,
    humanApprovalId?: string,
  ): Promise<CommitToolResult>;
}

export type AgentRunState =
  | "AWAITING_INTENT_CONFIRMATION"
  | "FILTERING"
  | "CHOOSING"
  | "CART_READY"
  | "COMMITTING"
  | "SUCCEEDED"
  | "REFUSED"
  | "REQUIRES_APPROVAL"
  | "FAILED";

export interface AgentEvent {
  readonly sequence: number;
  readonly state: AgentRunState;
  readonly type: string;
  readonly detail: string;
  readonly data?: JsonValue;
}

export interface IntentEnvelope {
  readonly proposal: ShoppingIntentProposal;
  readonly fingerprint: string;
  readonly modelId: string;
  readonly claimLevel: AgentClaimLevel;
}

export interface AgentRunResult {
  readonly state: AgentRunState;
  readonly modelId: string;
  readonly claimLevel: AgentClaimLevel;
  readonly intent: ShoppingIntentProposal;
  readonly events: readonly AgentEvent[];
  readonly cart: CartView | null;
  readonly commit: CommitToolResult | null;
  readonly failureReason: string | null;
  readonly stepsUsed: number;
}

export interface RuntimeLimits {
  readonly maxSteps: number;
  readonly maxDurationMs: number;
  readonly maxRepeatedAction: number;
}
