import type { ImportColumnMapping } from "@conduit/contracts";
import { normalizeHeader } from "./csv.js";
import type { MappingProposal } from "./types.js";

const aliases = {
  sku: ["sku", "product_sku", "item_code", "product_code", "id"],
  displayName: ["display_name", "name", "product_name", "title", "item_name"],
  description: ["description", "product_description", "details"],
  category: ["category", "product_category", "type"],
  price: ["price_minor_units", "minor_units", "price", "unit_price", "mrp"],
  currency: ["currency", "price_currency", "currency_code"],
  stock: ["stock", "quantity", "inventory", "available_quantity", "qty"],
} as const;

export function inferColumnMapping(headers: readonly string[]): MappingProposal {
  const find = (field: keyof typeof aliases): string | null => {
    for (const alias of aliases[field]) {
      const match = headers.find((header) => normalizeHeader(header) === alias);
      if (match) return match;
    }
    return null;
  };
  const sku = find("sku");
  const displayName = find("displayName");
  const price = find("price");
  const description = find("description");
  const category = find("category");
  const stock = find("stock");
  const currency = find("currency");
  const mapped = new Set(
    [sku, displayName, price, description, category, stock, currency].filter(
      (value): value is string => value !== null,
    ),
  );
  const mapping: ImportColumnMapping = {
    sku: sku ?? "",
    displayName: displayName ?? "",
    description,
    category,
    price: price ?? "",
    priceUnit:
      price && ["price_minor_units", "minor_units"].includes(normalizeHeader(price))
        ? "MINOR"
        : "MAJOR",
    currency,
    stock,
    attributeColumns: Object.fromEntries(
      headers
        .filter((header) => !mapped.has(header))
        .filter((header) => normalizeHeader(header).startsWith("attr_"))
        .map((header) => [header, normalizeHeader(header).slice(5)]),
    ),
  };
  const missingRequiredFields = [
    ...(sku ? [] : (["sku"] as const)),
    ...(displayName ? [] : (["displayName"] as const)),
    ...(price ? [] : (["price"] as const)),
  ];
  return {
    mapping,
    inferredFields: [
      sku && "sku",
      displayName && "displayName",
      price && "price",
      description && "description",
      category && "category",
      stock && "stock",
      currency && "currency",
    ].filter((value): value is string => Boolean(value)),
    missingRequiredFields,
  };
}
