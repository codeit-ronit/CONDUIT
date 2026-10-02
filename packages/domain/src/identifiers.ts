import { CommerceError } from "./commerce-error.js";

declare const identifierBrand: unique symbol;

type BrandedIdentifier<TName extends string> = string & {
  readonly [identifierBrand]: TName;
};

export type TenantId = BrandedIdentifier<"TenantId">;
export type MerchantId = BrandedIdentifier<"MerchantId">;
export type ProductId = BrandedIdentifier<"ProductId">;
export type CartId = BrandedIdentifier<"CartId">;
export type OrderId = BrandedIdentifier<"OrderId">;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function tenantId(value: string): TenantId {
  return identifier(value, "tenant") as TenantId;
}

export function merchantId(value: string): MerchantId {
  return identifier(value, "merchant") as MerchantId;
}

export function productId(value: string): ProductId {
  return identifier(value, "product") as ProductId;
}

export function cartId(value: string): CartId {
  return identifier(value, "cart") as CartId;
}

export function orderId(value: string): OrderId {
  return identifier(value, "order") as OrderId;
}

function identifier(value: string, kind: string): string {
  if (!UUID.test(value)) {
    throw new CommerceError("INVALID_IDENTIFIER", `${kind} identifier must be a UUID`);
  }

  return value.toLowerCase();
}
