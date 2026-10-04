import { describe, expect, it } from "vitest";

import { inferColumnMapping, parseCsv, previewTable } from "../src/index.js";

describe("merchant spreadsheet preview", () => {
  it("parses quoted CSV and infers common columns", () => {
    const table = parseCsv(
      'Item Code,Product Name,Price,Stock,attr_vegetarian,Description\r\nPANEER-01,"Paneer, Tikka",199.00,5,true,"Line one\nLine two"',
    );
    const proposal = inferColumnMapping(table.headers);
    expect(proposal.mapping).toMatchObject({
      sku: "Item Code",
      displayName: "Product Name",
      price: "Price",
      stock: "Stock",
      attributeColumns: { attr_vegetarian: "vegetarian" },
    });
    const preview = previewTable(table, "INR");
    expect(preview.rows[0]?.normalized).toMatchObject({
      sku: "PANEER-01",
      displayName: "Paneer, Tikka",
      minorUnits: "19900",
      stock: 5,
      attributes: { vegetarian: "true" },
    });
  });

  it("gives every rejected row a stable reason", () => {
    const table = parseCsv(
      "sku,name,price,stock\nGOOD-1,Good,10.00,4\nGOOD-1,Duplicate,12.00,2\nbad sku,Bad,12.00,2\nNO-PRICE,Missing,,2\nBAD-STOCK,Stock,12.00,1.5",
    );
    const rows = previewTable(table, "INR").rows;
    expect(rows.map((row) => row.reasonCode)).toEqual([
      null,
      "DUPLICATE_IN_FILE",
      "INVALID_SKU",
      "MISSING_REQUIRED_VALUE",
      "INVALID_STOCK",
    ]);
    expect(
      rows
        .filter((row) => row.disposition === "SKIPPED")
        .every((row) => Boolean(row.explanation)),
    ).toBe(true);
  });

  it("never accepts floating-point ambiguity beyond two decimals", () => {
    const row = previewTable(parseCsv("sku,name,price\nONE,One,0.001"), "INR").rows[0];
    expect(row).toMatchObject({
      disposition: "SKIPPED",
      reasonCode: "INVALID_PRICE",
    });
  });
});
