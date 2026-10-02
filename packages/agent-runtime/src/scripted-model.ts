import type { BuyerAction, ShoppingIntentProposal } from "@conduit/contracts";

import type { BuyerModel, IntentRequest, ModelTurnContext } from "./types.js";

export class ScriptedBuyerModel implements BuyerModel {
  public readonly id = "scripted-buyer-v1";
  public readonly claimLevel = "SCRIPTED" as const;

  public constructor(
    private readonly intentOverrides: Partial<ShoppingIntentProposal> = {},
  ) {}

  public proposeIntent(input: IntentRequest): Promise<unknown> {
    return Promise.resolve({
      schemaVersion: "buyer-intent-v1",
      merchantId: input.merchantId,
      currency: input.currency,
      maximumMinorUnits: input.defaultMaximumMinorUnits,
      category: "dinner",
      quantity: 2,
      excludedTerms: ["beef"],
      requiredAttributes: { vegetarian: "true" },
      summary: "Two vegetarian dinner portions, no beef, within the stated budget.",
      ...this.intentOverrides,
    });
  }

  public nextAction(context: ModelTurnContext): Promise<unknown> {
    if (context.cart === null) {
      const first = context.candidates[0];
      const action: BuyerAction = first
        ? {
            kind: "SELECT_PRODUCT",
            productId: first.productId,
            quantity: context.intent.quantity,
            statedTotalMinorUnits: null,
            reason:
              "Choose the cheapest candidate that passed deterministic filtering.",
          }
        : {
            kind: "REFUSE",
            productId: null,
            quantity: null,
            statedTotalMinorUnits: null,
            reason: "No candidate satisfies all confirmed constraints.",
          };
      return Promise.resolve(action);
    }
    return Promise.resolve({
      kind: "COMMIT",
      productId: null,
      quantity: null,
      statedTotalMinorUnits: context.cart.totalMinorUnits,
      reason: "Request the commit gate using the latest server-computed total.",
    } satisfies BuyerAction);
  }
}
