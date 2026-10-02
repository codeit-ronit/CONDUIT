import { ScriptedBuyerModel } from "./scripted-model.js";
import type { BuyerModel, IntentRequest, ModelTurnContext } from "./types.js";

export type FlawMode = "MALFORMED_OUTPUT" | "WRONG_TOTAL" | "REPEATED_ACTION";

export class FlawedBuyerModel implements BuyerModel {
  public readonly id: string;
  public readonly claimLevel = "DELIBERATELY_FLAWED" as const;
  readonly #scripted = new ScriptedBuyerModel();

  public constructor(private readonly flaw: FlawMode) {
    this.id = `flawed-buyer-v1:${flaw.toLowerCase()}`;
  }

  public proposeIntent(input: IntentRequest): Promise<unknown> {
    if (this.flaw === "MALFORMED_OUTPUT") {
      return Promise.resolve({ merchantId: input.merchantId, unrestricted: true });
    }
    return this.#scripted.proposeIntent(input);
  }

  public async nextAction(context: ModelTurnContext): Promise<unknown> {
    if (this.flaw === "WRONG_TOTAL" && context.cart !== null) {
      return {
        kind: "COMMIT",
        productId: null,
        quantity: null,
        statedTotalMinorUnits: "1",
        reason:
          "Deliberately mis-state the total to test the deterministic commit gate.",
      };
    }
    if (this.flaw === "REPEATED_ACTION") {
      const first = context.candidates[0];
      return {
        kind: "SELECT_PRODUCT",
        productId: first?.productId ?? null,
        quantity: context.intent.quantity,
        statedTotalMinorUnits: null,
        reason: "Repeat the same selection forever unless the runtime stops it.",
      };
    }
    return this.#scripted.nextAction(context);
  }
}
