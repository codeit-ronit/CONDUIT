import type { ImportColumnMapping } from "@conduit/contracts";

import type { StorefrontDocument, TabularData } from "./types.js";

export interface StorefrontExtraction {
  readonly table: TabularData;
  readonly mapping: ImportColumnMapping;
  readonly format: "JSON_LD" | "MICRODATA" | "OPEN_GRAPH";
}

const headers = [
  "schema.org/sku",
  "schema.org/name",
  "schema.org/description",
  "schema.org/category",
  "schema.org/offers.price",
  "schema.org/offers.priceCurrency",
  "schema.org/inventoryLevel",
  "schema.org/brand",
] as const;

export function extractStorefrontProducts(
  document: StorefrontDocument,
): StorefrontExtraction {
  const jsonLd = extractJsonLd(document.html);
  if (jsonLd.length > 0) return extraction(jsonLd, "JSON_LD");
  const microdata = extractMicrodata(document.html);
  if (microdata.length > 0) return extraction(microdata, "MICRODATA");
  const openGraph = extractOpenGraph(document.html);
  if (openGraph.length > 0) return extraction(openGraph, "OPEN_GRAPH");
  throw new Error(
    "No supported structured products were found in JSON-LD, microdata, or Open Graph.",
  );
}

function extraction(
  rows: readonly (readonly string[])[],
  format: StorefrontExtraction["format"],
): StorefrontExtraction {
  return {
    table: { headers, rows },
    mapping: {
      sku: headers[0],
      displayName: headers[1],
      description: headers[2],
      category: headers[3],
      price: headers[4],
      priceUnit: "MAJOR",
      currency: headers[5],
      stock: headers[6],
      attributeColumns: { [headers[7]]: "brand" },
    },
    format,
  };
}

function extractJsonLd(html: string): readonly (readonly string[])[] {
  const rows: string[][] = [];
  const scripts = html.matchAll(
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/giu,
  );
  for (const match of scripts) {
    const body = match[1];
    if (!body) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(decodeHtml(body.trim())) as unknown;
    } catch {
      continue;
    }
    for (const value of flattenJsonLd(parsed)) {
      if (!isProduct(value)) continue;
      const offer = firstRecord(value.offers);
      const inventory = firstRecord(value.inventoryLevel);
      rows.push([
        string(value.sku),
        string(value.name),
        string(value.description),
        string(value.category),
        string(offer?.price ?? value.price),
        string(offer?.priceCurrency ?? value.priceCurrency),
        string(inventory?.value ?? value.inventoryLevelValue ?? "0"),
        brandName(value.brand),
      ]);
    }
  }
  return rows;
}

function extractMicrodata(html: string): readonly (readonly string[])[] {
  if (!/itemtype=["'][^"']*schema\.org\/Product["']/iu.test(html)) return [];
  const field = (name: string) => {
    const pattern = new RegExp(
      `<[^>]+itemprop=["']${name}["'][^>]*(?:content=["']([^"']*)["'])?[^>]*>([^<]*)`,
      "iu",
    );
    const match = pattern.exec(html);
    return decodeHtml(match?.[1] ?? match?.[2] ?? "").trim();
  };
  const sku = field("sku");
  const name = field("name");
  const price = field("price");
  if (!sku || !name || !price) return [];
  return [
    [
      sku,
      name,
      field("description"),
      field("category"),
      price,
      field("priceCurrency"),
      field("inventoryLevel") || "0",
      field("brand"),
    ],
  ];
}

function extractOpenGraph(html: string): readonly (readonly string[])[] {
  const meta = new Map<string, string>();
  for (const match of html.matchAll(/<meta\b([^>]+)>/giu)) {
    const attributes = match[1] ?? "";
    const key = /(?:property|name)=["']([^"']+)["']/iu.exec(attributes)?.[1];
    const content = /content=["']([^"']*)["']/iu.exec(attributes)?.[1];
    if (key && content) meta.set(key.toLowerCase(), decodeHtml(content));
  }
  const sku = meta.get("product:retailer_item_id") ?? meta.get("product:sku") ?? "";
  const name = meta.get("og:title") ?? "";
  const price = meta.get("product:price:amount") ?? "";
  if (!sku || !name || !price) return [];
  return [
    [
      sku,
      name,
      meta.get("og:description") ?? "",
      meta.get("product:category") ?? "uncategorized",
      price,
      meta.get("product:price:currency") ?? "",
      "0",
      meta.get("product:brand") ?? "",
    ],
  ];
}

function flattenJsonLd(value: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd);
  if (!isRecord(value)) return [];
  const graph = value["@graph"];
  return graph ? [...flattenJsonLd(graph), value] : [value];
}

function isProduct(value: Record<string, unknown>): boolean {
  const type = value["@type"];
  const supportedTypes = new Set(["Product", "ProductGroup"]);
  return Array.isArray(type)
    ? type.some((entry) => typeof entry === "string" && supportedTypes.has(entry))
    : typeof type === "string" && supportedTypes.has(type);
}

function firstRecord(value: unknown): Record<string, unknown> | null {
  const values: readonly unknown[] = Array.isArray(value) ? value : [value];
  const first: unknown = values[0];
  return isRecord(first) ? first : null;
}

function brandName(value: unknown): string {
  if (typeof value === "string") return value;
  const brand = firstRecord(value);
  return string(brand?.name);
}

function string(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeHtml(value: string): string {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}
