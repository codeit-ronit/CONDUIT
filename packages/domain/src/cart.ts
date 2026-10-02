import type { CartId, MerchantId, ProductId, TenantId } from "./identifiers.js";
import { Money } from "./money.js";

export type CartStatus = "OPEN" | "COMMITTING" | "COMMITTED";

export interface PricedCartLine {
  readonly productId: ProductId;
  readonly sku: string;
  readonly displayName: string;
  readonly quantity: number;
  readonly unitPrice: Money;
  readonly priceVersion: number;
  readonly lineTotal: Money;
}

export interface PricedCart {
  readonly id: CartId;
  readonly tenantId: TenantId;
  readonly merchantId: MerchantId;
  readonly status: CartStatus;
  readonly lines: readonly PricedCartLine[];
  readonly total: Money;
}

export function calculateLineTotal(unitPrice: Money, quantity: number): Money {
  return unitPrice.multiply(BigInt(quantity));
}

export function calculateCartTotal(
  currency: string,
  lines: readonly Pick<PricedCartLine, "lineTotal">[],
): Money {
  return lines.reduce(
    (total, line) => total.add(line.lineTotal),
    Money.fromMinorUnits(currency, 0n),
  );
}
