import { describe, expect, it } from "vitest";

import { moneySchema, nonNegativeMoneySchema } from "../src/index.js";

describe("money contract", () => {
  it("accepts canonical integer strings", () => {
    expect(moneySchema.parse({ currency: "INR", minorUnits: "19900" })).toEqual({
      currency: "INR",
      minorUnits: "19900",
    });
  });

  it.each(["199.00", "01", "+1", "1e2", "", " 1"])(
    "rejects non-canonical minor units: %s",
    (minorUnits) => {
      expect(moneySchema.safeParse({ currency: "INR", minorUnits }).success).toBe(
        false,
      );
    },
  );

  it("rejects unknown fields instead of silently discarding them", () => {
    expect(
      moneySchema.safeParse({
        currency: "INR",
        minorUnits: "100",
        agentPrice: "1",
      }).success,
    ).toBe(false);
  });

  it("supports a stricter non-negative amount at trust boundaries", () => {
    expect(
      nonNegativeMoneySchema.safeParse({
        currency: "INR",
        minorUnits: "0",
      }).success,
    ).toBe(true);
    expect(
      nonNegativeMoneySchema.safeParse({
        currency: "INR",
        minorUnits: "-1",
      }).success,
    ).toBe(false);
  });
});
