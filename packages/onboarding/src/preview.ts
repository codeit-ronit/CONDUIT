import { createHash } from "node:crypto";

import type { ImportColumnMapping } from "@conduit/contracts";
import { importColumnMappingSchema } from "@conduit/contracts";
import { canonicalJson } from "@conduit/observability";
import type { JsonValue } from "@conduit/observability";

import { inferColumnMapping } from "./mapping.js";
import type { MappingProposal, PreviewImportRow, TabularData } from "./types.js";

export function previewTable(
  table: TabularData,
  currency: string,
  mappingOverride?: ImportColumnMapping,
): { readonly proposal: MappingProposal; readonly rows: readonly PreviewImportRow[] } {
  const inferred = inferColumnMapping(table.headers);
  const mapping = mappingOverride
    ? importColumnMappingSchema.parse(mappingOverride)
    : inferred.mapping;
  const missing = [
    ...(mapping.sku ? [] : (["sku"] as const)),
    ...(mapping.displayName ? [] : (["displayName"] as const)),
    ...(mapping.price ? [] : (["price"] as const)),
  ];
  const proposal = { ...inferred, mapping, missingRequiredFields: missing };
  if (missing.length > 0) return { proposal, rows: [] };
  assertMappedHeaders(table.headers, mapping);

  const seenSkus = new Set<string>();
  const rows = table.rows.map((values, index) => {
    const raw = Object.fromEntries(
      table.headers.map((header, column) => [header, values[column]?.trim() ?? ""]),
    );
    return normalizeRow(raw, index + 2, currency, mapping, seenSkus);
  });
  return { proposal, rows };
}

export function sourceDigest(content: string | Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

export function confirmationFingerprint(input: {
  readonly tenantId: string;
  readonly merchantId: string;
  readonly sourceDigest: string;
  readonly mapping: ImportColumnMapping;
  readonly rows: readonly PreviewImportRow[];
}): string {
  const serialized: unknown = JSON.parse(JSON.stringify(input));
  return createHash("sha256")
    .update(canonicalJson(serialized as JsonValue))
    .digest("hex");
}

function normalizeRow(
  raw: Readonly<Record<string, string>>,
  rowNumber: number,
  currency: string,
  mapping: ImportColumnMapping,
  seenSkus: Set<string>,
): PreviewImportRow {
  const sku = raw[mapping.sku]?.toUpperCase() ?? "";
  const displayName = raw[mapping.displayName] ?? "";
  const price = raw[mapping.price] ?? "";
  if (!sku || !displayName || !price)
    return skipped(
      rowNumber,
      raw,
      "MISSING_REQUIRED_VALUE",
      "SKU, name, and price are required.",
    );
  if (!/^[A-Z0-9][A-Z0-9._-]{0,63}$/u.test(sku))
    return skipped(
      rowNumber,
      raw,
      "INVALID_SKU",
      "SKU must use 1–64 uppercase letters, numbers, dots, dashes, or underscores.",
    );
  if (seenSkus.has(sku))
    return skipped(
      rowNumber,
      raw,
      "DUPLICATE_IN_FILE",
      "The same SKU already appeared earlier in this file.",
    );
  let minorUnits: string;
  try {
    minorUnits = parsePrice(price, mapping.priceUnit);
  } catch {
    return skipped(
      rowNumber,
      raw,
      "INVALID_PRICE",
      "Price must be a non-negative exact decimal value.",
    );
  }
  const stockText = mapping.stock ? (raw[mapping.stock] ?? "0") : "0";
  const stock = Number(stockText);
  if (!Number.isSafeInteger(stock) || stock < 0 || stock > 1_000_000)
    return skipped(
      rowNumber,
      raw,
      "INVALID_STOCK",
      "Stock must be an integer from 0 to 1,000,000.",
    );
  const rowCurrency = mapping.currency
    ? raw[mapping.currency]?.toUpperCase()
    : currency;
  if (rowCurrency && rowCurrency !== currency)
    return skipped(
      rowNumber,
      raw,
      "CURRENCY_MISMATCH",
      `Row currency ${rowCurrency} does not match merchant currency ${currency}.`,
    );
  seenSkus.add(sku);
  const attributes = Object.fromEntries(
    Object.entries(mapping.attributeColumns)
      .map(([column, attribute]) => [attribute, raw[column] ?? ""] as const)
      .filter(([, value]) => value.length > 0),
  );
  return {
    rowNumber,
    disposition: "READY",
    reasonCode: null,
    explanation: null,
    raw,
    normalized: {
      sku,
      displayName,
      description: mapping.description ? (raw[mapping.description] ?? "") : "",
      category: mapping.category
        ? nonEmptyOr(raw[mapping.category] ?? "", "uncategorized")
        : "uncategorized",
      attributes,
      currency,
      minorUnits,
      stock,
    },
  };
}

function nonEmptyOr(value: string, fallback: string): string {
  return value.length > 0 ? value : fallback;
}

function parsePrice(value: string, unit: "MAJOR" | "MINOR"): string {
  if (unit === "MINOR") {
    if (!/^\d+$/u.test(value)) throw new Error("invalid minor units");
    return BigInt(value).toString();
  }
  const match = /^(\d+)(?:\.(\d{1,2}))?$/u.exec(value);
  const whole = match?.[1];
  if (!match || !whole) throw new Error("invalid major units");
  return (BigInt(whole) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"))).toString();
}

function skipped(
  rowNumber: number,
  raw: Readonly<Record<string, string>>,
  reasonCode: Exclude<PreviewImportRow["reasonCode"], null>,
  explanation: string,
): PreviewImportRow {
  return {
    rowNumber,
    disposition: "SKIPPED",
    reasonCode,
    explanation,
    raw,
    normalized: null,
  };
}

function assertMappedHeaders(
  headers: readonly string[],
  mapping: ImportColumnMapping,
): void {
  const required = [
    mapping.sku,
    mapping.displayName,
    mapping.price,
    mapping.currency,
    mapping.description,
    mapping.category,
    mapping.stock,
    ...Object.keys(mapping.attributeColumns),
  ].filter((value): value is string => value !== null);
  const missing = required.filter((header) => !headers.includes(header));
  if (missing.length > 0)
    throw new Error(`Mapped columns are missing: ${missing.join(", ")}`);
}
