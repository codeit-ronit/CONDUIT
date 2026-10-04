import type { CatalogProduct } from "@conduit/domain";

import type { CatalogSource, UcpNegotiationResult, UcpPrincipal } from "./types.js";

export interface UcpCatalogSearchResponse {
  readonly ucp: UcpNegotiationResult;
  readonly products: readonly unknown[];
}

export async function searchUcpCatalog(
  source: CatalogSource,
  principal: UcpPrincipal,
  negotiation: UcpNegotiationResult,
  query: string,
): Promise<UcpCatalogSearchResponse> {
  const products = await source.listProducts(principal.tenantId, principal.merchantId);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return {
    ucp: negotiation,
    products: products
      .filter((product) => matches(product, normalizedQuery))
      .map(toUcpProduct),
  };
}

function matches(product: CatalogProduct, query: string): boolean {
  if (!query) return true;
  return [product.sku, product.displayName, product.category]
    .join(" ")
    .toLocaleLowerCase()
    .includes(query);
}

function toUcpProduct(product: CatalogProduct) {
  const amount = Number(product.price.minorUnits);
  if (!Number.isSafeInteger(amount)) {
    throw new RangeError("UCP JSON amount exceeds JavaScript's safe integer range");
  }
  const price = {
    amount,
    currency: product.price.currency,
  };
  return {
    id: product.id,
    title: product.displayName,
    description: { plain: product.description },
    categories: [{ value: product.category }],
    price_range: { min: price, max: price },
    variants: [
      {
        id: product.id,
        sku: product.sku,
        title: product.displayName,
        description: { plain: product.description },
        price,
        availability: {
          available: product.availableQuantity > 0,
          quantity: product.availableQuantity,
        },
      },
    ],
    metadata: {
      conduit_price_version: product.priceVersion,
      conduit_claim: "REAL_LOCAL_DATABASE",
    },
  };
}
