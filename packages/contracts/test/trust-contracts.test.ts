import { createAuthorizationGrantSchema, trustedCommitSchema } from "../src/index.js";
import { describe, expect, it } from "vitest";

const id = "00000000-0000-4000-8000-000000000001";

describe("trust boundary contracts", () => {
  it("accepts a bounded authorization and rejects hidden fields", () => {
    const input = {
      tenantId: id,
      buyerId: id,
      merchantId: id,
      maximumAmount: { currency: "INR", minorUnits: "100000" },
      allowedCategories: ["dinner"],
      allowedSkus: ["PANEER-01"],
      expiresAt: "2026-10-03T10:00:00+00:00",
      policyVersion: "trust-v1" as const,
    };
    expect(createAuthorizationGrantSchema.parse(input)).toEqual(input);
    expect(() =>
      createAuthorizationGrantSchema.parse({ ...input, bypass: true }),
    ).toThrow();
  });

  it("requires an itemized claimed quote, not only a total", () => {
    expect(() =>
      trustedCommitSchema.parse({
        tenantId: id,
        cartId: id,
        grantId: id,
        operationKey: "demo:one:1234",
        quote: {
          currency: "INR",
          lines: [],
          statedTotal: { currency: "INR", minorUnits: "0" },
        },
      }),
    ).toThrow();
  });
});
