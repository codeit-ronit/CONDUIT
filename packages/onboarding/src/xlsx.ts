import ExcelJS from "exceljs";
import { Readable } from "node:stream";

import type { TabularData } from "./types.js";

const maximumRows = 10_000;
const maximumColumns = 200;

export async function parseXlsx(content: Uint8Array): Promise<TabularData> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.read(Readable.from([content]));
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error("Workbook has no worksheet");
  if (worksheet.rowCount > maximumRows + 1)
    throw new Error(`Workbook exceeds ${String(maximumRows)} data rows`);
  if (worksheet.columnCount > maximumColumns)
    throw new Error(`Workbook exceeds ${String(maximumColumns)} columns`);

  const values: string[][] = [];
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    for (let column = 1; column <= worksheet.columnCount; column += 1) {
      cells.push(cellText(row.getCell(column).value));
    }
    values.push(cells);
  });
  const headers = values.shift()?.map((value) => value.trim()) ?? [];
  if (headers.length === 0) throw new Error("Workbook has no header row");
  return { headers, rows: values };
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if ("result" in value) return cellText(value.result ?? null);
    if ("text" in value && typeof value.text === "string") return value.text;
    if ("richText" in value) return value.richText.map((part) => part.text).join("");
    return "";
  }
  return String(value);
}
