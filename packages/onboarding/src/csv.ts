import type { TabularData } from "./types.js";

/** Small RFC-4180-style parser with quoted commas, quotes, CRLF and embedded newlines. */
export function parseCsv(source: string): TabularData {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source.charAt(index);
    if (character === '"') {
      if (quoted && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else quoted = !quoted;
      continue;
    }
    if (character === "," && !quoted) {
      record.push(field);
      field = "";
      continue;
    }
    if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      record.push(field);
      if (record.some((value) => value.length > 0)) records.push(record);
      record = [];
      field = "";
      continue;
    }
    field += character;
  }
  if (quoted) throw new Error("CSV contains an unclosed quoted field");
  record.push(field);
  if (record.some((value) => value.length > 0)) records.push(record);
  const headers = records.shift()?.map((value) => value.trim()) ?? [];
  if (headers.length === 0) throw new Error("Spreadsheet has no header row");
  if (new Set(headers.map(normalizeHeader)).size !== headers.length)
    throw new Error("Spreadsheet contains duplicate column headers");
  return { headers, rows: records };
}

export function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_|_$/gu, "");
}
