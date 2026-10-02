import type {
  AuthorizationGrantId,
  BuyerId,
  MerchantId,
  ProductId,
  PurchaseOperationId,
  TenantId,
} from "./identifiers.js";
import { Money } from "./money.js";

export interface AuthorizationGrant {
  readonly id: AuthorizationGrantId;
  readonly tenantId: TenantId;
  readonly buyerId: BuyerId;
  readonly merchantId: MerchantId;
  readonly maximumAmount: Money;
  readonly allowedCategories: readonly string[];
  readonly allowedSkus: readonly string[];
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly policyVersion: string;
}

export interface PurchaseQuoteLine {
  readonly productId: ProductId;
  readonly sku: string;
  readonly category: string;
  readonly quantity: number;
  readonly unitPrice: Money;
  readonly lineTotal: Money;
  readonly priceVersion: number;
}

export interface PurchaseQuote {
  readonly currency: string;
  readonly lines: readonly PurchaseQuoteLine[];
  readonly statedTotal: Money;
}

export type DrawdownEntryType = "RESERVE" | "CONFIRM" | "RELEASE" | "REVERSE";

export interface DrawdownEntry {
  readonly operationId: PurchaseOperationId;
  readonly type: DrawdownEntryType;
  readonly amount: Money;
}

export interface PurchasePolicyContext {
  readonly now: Date;
  readonly tenantId: TenantId;
  readonly merchantId: MerchantId;
  readonly grant: AuthorizationGrant;
  readonly claimedQuote: PurchaseQuote;
  readonly liveQuote: PurchaseQuote;
  readonly existingExposure: Money;
}

export type PolicyReasonCode =
  | "AUTHORIZED"
  | "QUOTE_ARITHMETIC_MISMATCH"
  | "PRICE_CHANGED"
  | "GRANT_EXPIRED"
  | "GRANT_REVOKED"
  | "TENANT_OUT_OF_SCOPE"
  | "MERCHANT_OUT_OF_SCOPE"
  | "CURRENCY_OUT_OF_SCOPE"
  | "CATEGORY_OUT_OF_SCOPE"
  | "SKU_OUT_OF_SCOPE"
  | "AMOUNT_EXCEEDS_REMAINING";

export type PolicyDecision =
  | {
      readonly outcome: "ALLOW";
      readonly reason: "AUTHORIZED";
      readonly explanation: string;
      readonly recoveryAction: null;
    }
  | {
      readonly outcome: "DENY" | "REQUIRE_APPROVAL";
      readonly reason: Exclude<PolicyReasonCode, "AUTHORIZED">;
      readonly explanation: string;
      readonly recoveryAction: string;
    };

/** Pure rule evaluation: no database, clock, network, or model access. */
export function evaluatePurchasePolicy(context: PurchasePolicyContext): PolicyDecision {
  const { grant, claimedQuote, liveQuote } = context;

  if (!quoteArithmeticIsCorrect(claimedQuote)) {
    return deny(
      "QUOTE_ARITHMETIC_MISMATCH",
      "The stated total does not equal quantity × unit price for every line.",
      "Recalculate the quote from its line items before trying again.",
    );
  }
  if (grant.tenantId !== context.tenantId) {
    return deny(
      "TENANT_OUT_OF_SCOPE",
      "The authorization belongs to a different tenant.",
      "Use an authorization issued by this tenant.",
    );
  }
  if (grant.merchantId !== context.merchantId) {
    return deny(
      "MERCHANT_OUT_OF_SCOPE",
      "The authorization does not cover this merchant.",
      "Ask the buyer for a grant covering this merchant.",
    );
  }
  if (grant.revokedAt !== null) {
    return deny(
      "GRANT_REVOKED",
      "The buyer revoked this authorization.",
      "Create a new authorization with the buyer's consent.",
    );
  }
  if (context.now.getTime() >= grant.expiresAt.getTime()) {
    return deny(
      "GRANT_EXPIRED",
      "The authorization has expired.",
      "Ask the buyer to issue a new authorization.",
    );
  }
  if (
    claimedQuote.currency !== grant.maximumAmount.currency ||
    liveQuote.currency !== grant.maximumAmount.currency
  ) {
    return deny(
      "CURRENCY_OUT_OF_SCOPE",
      "The cart currency differs from the authorized currency.",
      "Use a cart and authorization with the same currency.",
    );
  }

  for (const line of liveQuote.lines) {
    if (
      grant.allowedCategories.length > 0 &&
      !grant.allowedCategories.includes(line.category)
    ) {
      return deny(
        "CATEGORY_OUT_OF_SCOPE",
        `${line.sku} is in category ${line.category}, which is not authorized.`,
        "Remove the item or request broader category permission.",
      );
    }
    if (grant.allowedSkus.length > 0 && !grant.allowedSkus.includes(line.sku)) {
      return deny(
        "SKU_OUT_OF_SCOPE",
        `${line.sku} is not in the authorization's SKU allow-list.`,
        "Remove the item or request permission for this SKU.",
      );
    }
  }

  const requestedExposure = context.existingExposure.add(liveQuote.statedTotal);
  if (requestedExposure.minorUnits > grant.maximumAmount.minorUnits) {
    const remaining = grant.maximumAmount.subtract(context.existingExposure);
    return deny(
      "AMOUNT_EXCEEDS_REMAINING",
      `The purchase exceeds the remaining authorized amount of ${remaining.minorUnits.toString()} minor units.`,
      "Reduce the cart or ask the buyer for a larger authorization.",
    );
  }

  if (!quotesMatch(claimedQuote, liveQuote)) {
    return {
      outcome: "REQUIRE_APPROVAL",
      reason: "PRICE_CHANGED",
      explanation: "The server's current catalog price differs from the quoted price.",
      recoveryAction:
        "Show the new itemized total to the buyer and submit a fresh quote.",
    };
  }

  return {
    outcome: "ALLOW",
    reason: "AUTHORIZED",
    explanation: "The live cart is inside every authorization and policy boundary.",
    recoveryAction: null,
  };
}

export function calculateAuthorizationExposure(
  currency: string,
  entries: readonly DrawdownEntry[],
): Money {
  let exposure = 0n;
  for (const entry of entries) {
    if (entry.amount.currency !== currency) {
      throw new Error("Drawdown entry currency does not match its authorization");
    }
    if (entry.type === "RESERVE") exposure += entry.amount.minorUnits;
    if (entry.type === "RELEASE" || entry.type === "REVERSE") {
      exposure -= entry.amount.minorUnits;
    }
  }
  if (exposure < 0n) throw new Error("Drawdown exposure cannot be negative");
  return Money.fromMinorUnits(currency, exposure);
}

function quoteArithmeticIsCorrect(quote: PurchaseQuote): boolean {
  let sum = Money.fromMinorUnits(quote.currency, 0n);
  for (const line of quote.lines) {
    if (
      line.quantity < 1 ||
      line.unitPrice.currency !== quote.currency ||
      line.lineTotal.currency !== quote.currency ||
      !line.unitPrice.multiply(BigInt(line.quantity)).equals(line.lineTotal)
    ) {
      return false;
    }
    sum = sum.add(line.lineTotal);
  }
  return sum.equals(quote.statedTotal);
}

function quotesMatch(claimed: PurchaseQuote, live: PurchaseQuote): boolean {
  if (!claimed.statedTotal.equals(live.statedTotal)) return false;
  if (claimed.lines.length !== live.lines.length) return false;
  const liveByProduct = new Map(live.lines.map((line) => [line.productId, line]));
  return claimed.lines.every((line) => {
    const current = liveByProduct.get(line.productId);
    return (
      current?.quantity === line.quantity &&
      current.priceVersion === line.priceVersion &&
      current.unitPrice.equals(line.unitPrice) &&
      current.lineTotal.equals(line.lineTotal)
    );
  });
}

function deny(
  reason: Exclude<PolicyReasonCode, "AUTHORIZED" | "PRICE_CHANGED">,
  explanation: string,
  recoveryAction: string,
): PolicyDecision {
  return { outcome: "DENY", reason, explanation, recoveryAction };
}
