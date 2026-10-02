import { describe, expect, it } from "vitest";

import { buyerActionSchema, shoppingIntentProposalSchema } from "../src/index.js";

const merchantId = "018f47a6-d879-7d3a-9f5a-96a73f0e11a2";

describe("agent contracts", () => {
  it("accepts an exact typed intent", () => {
    expect(
      shoppingIntentProposalSchema.parse({
        schemaVersion: "buyer-intent-v1",
        merchantId,
        currency: "INR",
        maximumMinorUnits: "80000",
        category: "dinner",
        quantity: 4,
        excludedTerms: ["beef"],
        requiredAttributes: { vegetarian: "true" },
        summary: "Dinner for four under ₹800, without beef.",
      }),
    ).toBeDefined();
  });

  it("rejects extra model-controlled fields", () => {
    expect(() =>
      buyerActionSchema.parse({
        kind: "COMMIT",
        productId: null,
        quantity: null,
        statedTotalMinorUnits: "1",
        reason: "Buy now",
        bypassPolicy: true,
      }),
    ).toThrow();
  });
});
