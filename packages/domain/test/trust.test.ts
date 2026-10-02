import {
  Money,
  authorizationGrantId,
  buyerId,
  calculateAuthorizationExposure,
  evaluatePurchasePolicy,
  merchantId,
  productId,
  purchaseOperationId,
  tenantId,
} from "../src/index.js";
import type { PurchasePolicyContext, PurchaseQuote } from "../src/index.js";
import { describe, expect, it } from "vitest";

const ids = {
  tenant: tenantId("00000000-0000-4000-8000-000000000001"),
  merchant: merchantId("00000000-0000-4000-8000-000000000002"),
  buyer: buyerId("00000000-0000-4000-8000-000000000003"),
  grant: authorizationGrantId("00000000-0000-4000-8000-000000000004"),
  product: productId("00000000-0000-4000-8000-000000000005"),
  operation: purchaseOperationId("00000000-0000-4000-8000-000000000006"),
};

function quote(
  unit = 19_900n,
  line = 39_800n,
  total = 39_800n,
  version = 1,
): PurchaseQuote {
  return {
    currency: "INR",
    lines: [
      {
        productId: ids.product,
        sku: "PANEER-01",
        category: "dinner",
        quantity: 2,
        unitPrice: Money.fromMinorUnits("INR", unit),
        lineTotal: Money.fromMinorUnits("INR", line),
        priceVersion: version,
      },
    ],
    statedTotal: Money.fromMinorUnits("INR", total),
  };
}

function context(
  overrides: Partial<PurchasePolicyContext> = {},
): PurchasePolicyContext {
  return {
    now: new Date("2026-10-02T10:00:00Z"),
    tenantId: ids.tenant,
    merchantId: ids.merchant,
    grant: {
      id: ids.grant,
      tenantId: ids.tenant,
      buyerId: ids.buyer,
      merchantId: ids.merchant,
      maximumAmount: Money.fromMinorUnits("INR", 100_000n),
      allowedCategories: ["dinner"],
      allowedSkus: ["PANEER-01"],
      expiresAt: new Date("2026-10-03T10:00:00Z"),
      revokedAt: null,
      policyVersion: "trust-v1",
    },
    claimedQuote: quote(),
    liveQuote: quote(),
    existingExposure: Money.fromMinorUnits("INR", 0n),
    ...overrides,
  };
}

describe("purchase policy", () => {
  it("allows an exact live quote inside the grant", () => {
    expect(evaluatePurchasePolicy(context())).toMatchObject({
      outcome: "ALLOW",
      reason: "AUTHORIZED",
    });
  });

  it("distinguishes wrong arithmetic from a live price movement", () => {
    expect(
      evaluatePurchasePolicy(
        context({ claimedQuote: quote(19_900n, 39_700n, 39_700n) }),
      ),
    ).toMatchObject({ outcome: "DENY", reason: "QUOTE_ARITHMETIC_MISMATCH" });

    expect(
      evaluatePurchasePolicy(
        context({ liveQuote: quote(22_500n, 45_000n, 45_000n, 2) }),
      ),
    ).toMatchObject({ outcome: "REQUIRE_APPROVAL", reason: "PRICE_CHANGED" });
  });

  it("counts held and confirmed money once and releases exposure", () => {
    const amount = Money.fromMinorUnits("INR", 20_000n);
    expect(
      calculateAuthorizationExposure("INR", [
        { operationId: ids.operation, type: "RESERVE", amount },
        { operationId: ids.operation, type: "CONFIRM", amount },
      ]).minorUnits,
    ).toBe(20_000n);
    expect(
      calculateAuthorizationExposure("INR", [
        { operationId: ids.operation, type: "RESERVE", amount },
        { operationId: ids.operation, type: "RELEASE", amount },
      ]).minorUnits,
    ).toBe(0n);
  });

  it("denies an amount above the remaining limit", () => {
    expect(
      evaluatePurchasePolicy(
        context({ existingExposure: Money.fromMinorUnits("INR", 70_000n) }),
      ),
    ).toMatchObject({ outcome: "DENY", reason: "AMOUNT_EXCEEDS_REMAINING" });
  });
});
