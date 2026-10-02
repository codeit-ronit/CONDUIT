export const commerceErrorCodes = [
  "TENANT_NOT_FOUND",
  "MERCHANT_NOT_FOUND",
  "PRODUCT_NOT_FOUND",
  "CART_NOT_FOUND",
  "CART_NOT_OPEN",
  "EMPTY_CART",
  "OUT_OF_STOCK",
  "DUPLICATE_SKU",
  "INVALID_QUANTITY",
  "INVALID_SKU",
  "INVALID_IDENTIFIER",
] as const;

export type CommerceErrorCode = (typeof commerceErrorCodes)[number];

export class CommerceError extends Error {
  public constructor(
    public readonly code: CommerceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CommerceError";
  }
}
