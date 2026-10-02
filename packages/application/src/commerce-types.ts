import type {
  CartId,
  CatalogProduct,
  MerchantId,
  Money,
  OrderId,
  PricedCart,
  PricedCartLine,
  ProductAttributes,
  ProductId,
  TenantId,
} from "@conduit/domain";

export interface Tenant {
  readonly id: TenantId;
  readonly slug: string;
  readonly displayName: string;
}

export interface Merchant {
  readonly id: MerchantId;
  readonly tenantId: TenantId;
  readonly slug: string;
  readonly displayName: string;
  readonly currency: string;
}

export interface PriceHistoryEntry {
  readonly version: number;
  readonly price: Money;
  readonly validFrom: Date;
  readonly validTo: Date | null;
}

export interface NewProduct {
  readonly tenantId: TenantId;
  readonly merchantId: MerchantId;
  readonly sku: string;
  readonly displayName: string;
  readonly description: string;
  readonly category: string;
  readonly attributes: ProductAttributes;
  readonly price: Money;
  readonly stock: number;
}

export interface ModelledOrder {
  readonly id: OrderId;
  readonly tenantId: TenantId;
  readonly merchantId: MerchantId;
  readonly cartId: CartId;
  readonly status: "MODELLED";
  readonly providerReference: string;
  readonly lines: readonly PricedCartLine[];
  readonly total: Money;
}

export interface CommerceRepository {
  createTenant(slug: string, displayName: string): Promise<Tenant>;
  createMerchant(
    tenantId: TenantId,
    slug: string,
    displayName: string,
    currency: string,
  ): Promise<Merchant>;
  createProduct(product: NewProduct): Promise<CatalogProduct>;
  changePrice(
    tenantId: TenantId,
    productId: ProductId,
    price: Money,
  ): Promise<CatalogProduct>;
  listProducts(
    tenantId: TenantId,
    merchantId: MerchantId,
  ): Promise<readonly CatalogProduct[]>;
  getPriceHistory(
    tenantId: TenantId,
    productId: ProductId,
  ): Promise<readonly PriceHistoryEntry[]>;
  createCart(tenantId: TenantId, merchantId: MerchantId): Promise<PricedCart>;
  setCartLine(
    tenantId: TenantId,
    cartId: CartId,
    productId: ProductId,
    quantity: number,
  ): Promise<PricedCart>;
  removeCartLine(
    tenantId: TenantId,
    cartId: CartId,
    productId: ProductId,
  ): Promise<PricedCart>;
  getCart(tenantId: TenantId, cartId: CartId): Promise<PricedCart>;
  commitCart(
    tenantId: TenantId,
    cartId: CartId,
    providerReference: string,
  ): Promise<ModelledOrder>;
}

export interface ModelledOrderProvider {
  referenceFor(cartId: CartId): string;
}
