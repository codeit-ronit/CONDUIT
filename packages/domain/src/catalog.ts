import { CommerceError } from "./commerce-error.js";
import type { MerchantId, ProductId, TenantId } from "./identifiers.js";
import type { Money } from "./money.js";

const SKU = /^[A-Z0-9][A-Z0-9._-]{0,63}$/u;

export type ProductAttributeValue = string | boolean | readonly string[];
export type ProductAttributes = Readonly<Record<string, ProductAttributeValue>>;

export interface CatalogProduct {
  readonly id: ProductId;
  readonly tenantId: TenantId;
  readonly merchantId: MerchantId;
  readonly sku: string;
  readonly displayName: string;
  readonly description: string;
  readonly category: string;
  readonly attributes: ProductAttributes;
  readonly price: Money;
  readonly priceVersion: number;
  readonly availableQuantity: number;
}

export function productSku(value: string): string {
  if (!SKU.test(value)) {
    throw new CommerceError(
      "INVALID_SKU",
      "SKU must contain 1-64 uppercase letters, numbers, dots, dashes, or underscores",
    );
  }

  return value;
}

export function cartQuantity(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 999) {
    throw new CommerceError(
      "INVALID_QUANTITY",
      "Cart quantity must be an integer from 1 to 999",
    );
  }

  return value;
}
