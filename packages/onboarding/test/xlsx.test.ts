import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { parseXlsx, previewTable } from "../src/index.js";

describe("XLSX onboarding", () => {
  it("reads the first worksheet into the same preview pipeline as CSV", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Products");
    sheet.addRow(["SKU", "Product Name", "Price", "Stock"]);
    sheet.addRow(["TEA-01", "Masala Tea", "50.00", 10]);
    const buffer = await workbook.xlsx.writeBuffer();
    const table = await parseXlsx(new Uint8Array(buffer));
    expect(previewTable(table, "INR").rows[0]?.normalized).toMatchObject({
      sku: "TEA-01",
      displayName: "Masala Tea",
      minorUnits: "5000",
      stock: 10,
    });
  });
});
