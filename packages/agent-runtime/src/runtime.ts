import { createHash } from "node:crypto";

import { buyerActionSchema, shoppingIntentProposalSchema } from "@conduit/contracts";
import type { BuyerAction, ShoppingIntentProposal } from "@conduit/contracts";
import { canonicalJson } from "@conduit/observability";
import type { JsonValue } from "@conduit/observability";

import type {
  AgentEvent,
  AgentRunResult,
  AgentRunState,
  BuyerModel,
  BuyerTools,
  CandidateProduct,
  CartView,
  CommitToolResult,
  IntentEnvelope,
  IntentRequest,
  RuntimeLimits,
} from "./types.js";

const defaultLimits: RuntimeLimits = {
  maxSteps: 6,
  maxDurationMs: 15_000,
  maxRepeatedAction: 2,
};

export class BoundedBuyerRuntime {
  public constructor(
    private readonly model: BuyerModel,
    private readonly tools: BuyerTools,
    private readonly limits: RuntimeLimits = defaultLimits,
    private readonly now: () => number = Date.now,
  ) {}

  public async proposeIntent(input: IntentRequest): Promise<IntentEnvelope> {
    const raw = await this.model.proposeIntent(input);
    const proposal = shoppingIntentProposalSchema.parse(raw);
    return {
      proposal,
      fingerprint: intentFingerprint(proposal),
      modelId: this.model.id,
      claimLevel: this.model.claimLevel,
    };
  }

  public async runConfirmed(
    envelope: IntentEnvelope,
    confirmationFingerprint: string,
    humanApprovalId?: string,
  ): Promise<AgentRunResult> {
    if (confirmationFingerprint !== envelope.fingerprint) {
      return this.terminal(
        "FAILED",
        envelope.proposal,
        [],
        null,
        null,
        "Intent confirmation does not match the proposed constraints.",
        0,
      );
    }

    const startedAt = this.now();
    const events: AgentEvent[] = [];
    const actions: BuyerAction[] = [];
    const repetitions = new Map<string, number>();
    let cart: CartView | null = null;
    let commit: CommitToolResult | null = null;
    let state: AgentRunState = "FILTERING";

    addEvent(events, state, "INTENT_CONFIRMED", envelope.proposal.summary);

    const catalog = await this.tools.searchCatalog(envelope.proposal.category);
    const candidates = deterministicFilter(catalog.products, envelope.proposal);
    addEvent(
      events,
      state,
      "CATALOG_FILTERED",
      `${String(candidates.length)} of ${String(catalog.products.length)} products satisfy code-enforced constraints.`,
      {
        candidateProductIds: candidates.map((product) => product.productId),
        untrustedTextObserved: catalog.untrustedTextObserved,
      },
    );

    if (candidates.length === 0) {
      return this.terminal(
        "REFUSED",
        envelope.proposal,
        events,
        null,
        null,
        "No product satisfies every confirmed constraint; none were relaxed.",
        0,
      );
    }

    for (let step = 1; step <= this.limits.maxSteps; step += 1) {
      if (this.now() - startedAt > this.limits.maxDurationMs) {
        return this.terminal(
          "FAILED",
          envelope.proposal,
          events,
          cart,
          commit,
          "Time budget exhausted before a safe terminal state.",
          step - 1,
        );
      }

      state = cart === null ? "CHOOSING" : "CART_READY";
      let action: BuyerAction;
      try {
        action = buyerActionSchema.parse(
          await this.model.nextAction({
            intent: envelope.proposal,
            candidates,
            cart,
            previousActions: actions,
            remainingSteps: this.limits.maxSteps - step + 1,
          }),
        );
        validateActionSemantics(action);
      } catch (error: unknown) {
        return this.terminal(
          "FAILED",
          envelope.proposal,
          events,
          cart,
          null,
          `Model output failed validation: ${errorMessage(error)}`,
          step,
        );
      }

      actions.push(action);
      const actionKey = canonicalJson(action);
      const repeated = (repetitions.get(actionKey) ?? 0) + 1;
      repetitions.set(actionKey, repeated);
      addEvent(events, state, "MODEL_ACTION_VALIDATED", action.reason, {
        kind: action.kind,
      });
      if (repeated > this.limits.maxRepeatedAction) {
        return this.terminal(
          "FAILED",
          envelope.proposal,
          events,
          cart,
          null,
          "Loop detected: the model repeated the identical action too many times.",
          step,
        );
      }

      if (action.kind === "REFUSE") {
        return this.terminal(
          "REFUSED",
          envelope.proposal,
          events,
          cart,
          null,
          action.reason,
          step,
        );
      }

      if (action.kind === "SELECT_PRODUCT") {
        const product = candidates.find(
          (candidate) => candidate.productId === action.productId,
        );
        if (!product || action.quantity !== envelope.proposal.quantity) {
          return this.terminal(
            "FAILED",
            envelope.proposal,
            events,
            cart,
            null,
            "The model selected outside the filtered candidates or changed the confirmed quantity.",
            step,
          );
        }
        await this.tools.setCartLine(product.productId, action.quantity);
        cart = await this.tools.reviewCart();
        addEvent(
          events,
          "CART_READY",
          "SERVER_TOTAL_RECOMPUTED",
          `Server total is ${cart.currency} ${cart.totalMinorUnits} minor units.`,
        );
        continue;
      }

      if (cart === null || action.statedTotalMinorUnits === null) {
        return this.terminal(
          "FAILED",
          envelope.proposal,
          events,
          cart,
          null,
          "The model requested commit before a server-priced cart existed.",
          step,
        );
      }
      state = "COMMITTING";
      commit = await this.tools.commit(action.statedTotalMinorUnits, humanApprovalId);
      addEvent(
        events,
        state,
        "COMMIT_GATE_RESULT",
        commit.outcome === "CONFIRMED"
          ? `Charged the server-authoritative total: ${commit.chargedMinorUnits} minor units.`
          : `${commit.reason}: ${commit.recoveryAction}`,
        { outcome: commit.outcome },
      );
      if (commit.outcome === "CONFIRMED") {
        return this.terminal(
          "SUCCEEDED",
          envelope.proposal,
          events,
          cart,
          commit,
          null,
          step,
        );
      }
      return this.terminal(
        commit.outcome === "REQUIRES_APPROVAL" ? "REQUIRES_APPROVAL" : "REFUSED",
        envelope.proposal,
        events,
        cart,
        commit,
        commit.reason,
        step,
      );
    }

    return this.terminal(
      "FAILED",
      envelope.proposal,
      events,
      cart,
      commit,
      "Step budget exhausted before a safe terminal state.",
      this.limits.maxSteps,
    );
  }

  private terminal(
    state: AgentRunState,
    intent: ShoppingIntentProposal,
    events: AgentEvent[],
    cart: CartView | null,
    commit: CommitToolResult | null,
    failureReason: string | null,
    stepsUsed: number,
  ): AgentRunResult {
    addEvent(
      events,
      state,
      "RUN_TERMINATED",
      failureReason ?? "The bounded purchase completed safely.",
    );
    return {
      state,
      modelId: this.model.id,
      claimLevel: this.model.claimLevel,
      intent,
      events,
      cart,
      commit,
      failureReason,
      stepsUsed,
    };
  }
}

export function deterministicFilter(
  products: readonly CandidateProduct[],
  intent: ShoppingIntentProposal,
): readonly CandidateProduct[] {
  const maximum = BigInt(intent.maximumMinorUnits);
  return products
    .filter((product) => product.category === intent.category)
    .filter((product) => product.availableQuantity >= intent.quantity)
    .filter(
      (product) =>
        BigInt(product.unitPriceMinorUnits) * BigInt(intent.quantity) <= maximum,
    )
    .filter((product) =>
      Object.entries(intent.requiredAttributes).every(([key, expected]) =>
        attributeMatches(product.attributes[key], expected),
      ),
    )
    .filter((product) =>
      intent.excludedTerms.every(
        (term) => !product.sku.toLowerCase().includes(term.toLowerCase()),
      ),
    )
    .toSorted((left, right) =>
      BigInt(left.unitPriceMinorUnits) < BigInt(right.unitPriceMinorUnits) ? -1 : 1,
    );
}

export function intentFingerprint(intent: ShoppingIntentProposal): string {
  return createHash("sha256").update(canonicalJson(intent)).digest("hex");
}

function validateActionSemantics(action: BuyerAction): void {
  if (
    action.kind === "SELECT_PRODUCT" &&
    (action.productId === null ||
      action.quantity === null ||
      action.statedTotalMinorUnits !== null)
  ) {
    throw new Error("SELECT_PRODUCT needs productId and quantity only");
  }
  if (
    action.kind === "COMMIT" &&
    (action.productId !== null ||
      action.quantity !== null ||
      action.statedTotalMinorUnits === null)
  ) {
    throw new Error("COMMIT needs only the model's stated total");
  }
  if (
    action.kind === "REFUSE" &&
    (action.productId !== null ||
      action.quantity !== null ||
      action.statedTotalMinorUnits !== null)
  ) {
    throw new Error("REFUSE must not contain action arguments");
  }
}

function attributeMatches(
  actual: string | boolean | readonly string[] | undefined,
  expected: string,
): boolean {
  if (typeof actual === "string" || typeof actual === "boolean")
    return String(actual).toLowerCase() === expected.toLowerCase();
  if (actual)
    return actual.some((item) => item.toLowerCase() === expected.toLowerCase());
  return false;
}

function addEvent(
  events: AgentEvent[],
  state: AgentRunState,
  type: string,
  detail: string,
  data?: JsonValue,
): void {
  events.push({
    sequence: events.length + 1,
    state,
    type,
    detail,
    ...(data === undefined ? {} : { data }),
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown validation error";
}
