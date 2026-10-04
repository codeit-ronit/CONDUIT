import type {
  CartCommandInput,
  ChangePriceInput,
  CreateCartInput,
  CreateMerchantInput,
  CreateProductInput,
  CreateTenantInput,
  SetCartLineInput,
} from "@conduit/contracts";
import {
  Money,
  cartId,
  cartQuantity,
  merchantId,
  productId,
  productSku,
  tenantId,
} from "@conduit/domain";
import type { CatalogProduct, PricedCart } from "@conduit/domain";

import type {
  CommerceRepository,
  Merchant,
  ModelledOrder,
  ModelledOrderProvider,
  Tenant,
} from "./commerce-types.js";

export class CommerceService {
  public constructor(
    private readonly repository: CommerceRepository,
    private readonly orderProvider: ModelledOrderProvider,
  ) {}

  public createTenant(input: CreateTenantInput): Promise<Tenant> {
    return this.repository.createTenant(input.slug, input.displayName);
  }

  public createMerchant(input: CreateMerchantInput): Promise<Merchant> {
    return this.repository.createMerchant(
      tenantId(input.tenantId),
      input.slug,
      input.displayName,
      input.currency,
    );
  }

  public createProduct(input: CreateProductInput): Promise<CatalogProduct> {
    return this.repository.createProduct({
      tenantId: tenantId(input.tenantId),
      merchantId: merchantId(input.merchantId),
      sku: productSku(input.sku),
      displayName: input.displayName,
      description: input.description,
      category: input.category,
      attributes: input.attributes,
      price: moneyFromContract(input.price),
      stock: input.stock,
    });
  }

  public changePrice(input: ChangePriceInput): Promise<CatalogProduct> {
    return this.repository.changePrice(
      tenantId(input.tenantId),
      productId(input.productId),
      moneyFromContract(input.price),
    );
  }

  public listProducts(
    rawTenantId: string,
    rawMerchantId: string,
  ): Promise<readonly CatalogProduct[]> {
    return this.repository.listProducts(
      tenantId(rawTenantId),
      merchantId(rawMerchantId),
    );
  }

  public getPriceHistory(rawTenantId: string, rawProductId: string) {
    return this.repository.getPriceHistory(
      tenantId(rawTenantId),
      productId(rawProductId),
    );
  }

  public createCart(input: CreateCartInput): Promise<PricedCart> {
    return this.repository.createCart(
      tenantId(input.tenantId),
      merchantId(input.merchantId),
    );
  }

  public setCartLine(input: SetCartLineInput): Promise<PricedCart> {
    return this.repository.setCartLine(
      tenantId(input.tenantId),
      cartId(input.cartId),
      productId(input.productId),
      cartQuantity(input.quantity),
    );
  }

  public replaceCartLines(input: {
    readonly tenantId: string;
    readonly cartId: string;
    readonly lines: readonly {
      readonly productId: string;
      readonly quantity: number;
    }[];
  }): Promise<PricedCart> {
    const seen = new Set<string>();
    const lines = input.lines.map((line) => {
      if (seen.has(line.productId)) {
        throw new Error("A cart cannot contain the same product twice");
      }
      seen.add(line.productId);
      return {
        productId: productId(line.productId),
        quantity: cartQuantity(line.quantity),
      };
    });
    return this.repository.replaceCartLines(
      tenantId(input.tenantId),
      cartId(input.cartId),
      lines,
    );
  }

  public removeCartLine(
    input: CartCommandInput & { readonly productId: string },
  ): Promise<PricedCart> {
    return this.repository.removeCartLine(
      tenantId(input.tenantId),
      cartId(input.cartId),
      productId(input.productId),
    );
  }

  public getCart(input: CartCommandInput): Promise<PricedCart> {
    return this.repository.getCart(tenantId(input.tenantId), cartId(input.cartId));
  }

  public commitCart(input: CartCommandInput): Promise<ModelledOrder> {
    const parsedCartId = cartId(input.cartId);

    return this.repository.commitCart(
      tenantId(input.tenantId),
      parsedCartId,
      this.orderProvider.referenceFor(parsedCartId),
    );
  }
}

function moneyFromContract(input: {
  readonly currency: string;
  readonly minorUnits: string;
}): Money {
  return Money.fromMinorUnits(input.currency, BigInt(input.minorUnits));
}
