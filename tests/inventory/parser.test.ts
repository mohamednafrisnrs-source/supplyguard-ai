import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  InventoryCsvValidationError,
  parseInventoryCsv,
} from "../../src/lib/inventory";

const HEADERS =
  "sku,product_name,current_stock,average_daily_demand,lead_time_days,safety_stock,supplier";

function expectValidationCode(csv: string, code: string): void {
  try {
    parseInventoryCsv(csv);
    throw new Error("Expected CSV validation to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(InventoryCsvValidationError);
    const validationError = error as InventoryCsvValidationError;
    expect(validationError.issues.some((issue) => issue.code === code)).toBe(
      true,
    );
  }
}

describe("parseInventoryCsv", () => {
  it("parses the Phase 1 sample inventory", async () => {
    const csv = await readFile(
      new URL("../../src/data/inventory.csv", import.meta.url),
      "utf8",
    );

    const items = parseInventoryCsv(csv);

    expect(items).toHaveLength(15);
    expect(items[0]).toEqual({
      sku: "SG-1001",
      productName: "Industrial Nitrile Gloves - Medium",
      currentStock: 1840,
      averageDailyDemand: 126,
      leadTimeDays: 9,
      safetyStock: 700,
      supplier: "Northstar Safety Goods",
    });
  });

  it("supports quoted text and header columns in a different order", () => {
    const csv = [
      "supplier,sku,product_name,current_stock,average_daily_demand,lead_time_days,safety_stock",
      '"Example, Incorporated",SKU-1,"Widget, Blue",100,20,7,20',
    ].join("\n");

    expect(parseInventoryCsv(csv)).toEqual([
      {
        sku: "SKU-1",
        productName: "Widget, Blue",
        currentStock: 100,
        averageDailyDemand: 20,
        leadTimeDays: 7,
        safetyStock: 20,
        supplier: "Example, Incorporated",
      },
    ]);
  });

  it.each([
    [
      "missing header",
      "sku,product_name,current_stock,average_daily_demand,lead_time_days,supplier\nSKU-1,Widget,10,2,3,Example",
    ],
    [
      "unexpected header",
      `${HEADERS},warehouse\nSKU-1,Widget,10,2,3,4,Example,Main`,
    ],
    [
      "duplicate header",
      "sku,sku,current_stock,average_daily_demand,lead_time_days,safety_stock,supplier\nSKU-1,Widget,10,2,3,4,Example",
    ],
  ])("rejects an invalid header set: %s", (_name, csv) => {
    expectValidationCode(csv, "INVALID_HEADERS");
  });

  it("reports missing values without converting them to zero", () => {
    const csv = `${HEADERS}\nSKU-1,Widget,,20,7,20,Example`;

    try {
      parseInventoryCsv(csv);
      throw new Error("Expected CSV validation to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(InventoryCsvValidationError);
      const validationError = error as InventoryCsvValidationError;
      expect(validationError.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "MISSING_VALUE",
            row: 2,
            field: "current_stock",
          }),
          expect.objectContaining({
            code: "INVALID_NUMBER",
            row: 2,
            field: "current_stock",
          }),
        ]),
      );
    }
  });

  it.each(["-1", "12units", "1e3", "Infinity", "NaN"])(
    "rejects the invalid numeric value %s",
    (value) => {
      const csv = `${HEADERS}\nSKU-1,Widget,${value},20,7,20,Example`;
      expectValidationCode(csv, "INVALID_NUMBER");
    },
  );

  it("accepts zero values", () => {
    const csv = `${HEADERS}\nSKU-1,Widget,0,0,0,0,Example`;

    expect(parseInventoryCsv(csv)[0]).toEqual(
      expect.objectContaining({
        currentStock: 0,
        averageDailyDemand: 0,
        leadTimeDays: 0,
        safetyStock: 0,
      }),
    );
  });

  it("rejects duplicate SKUs case-insensitively", () => {
    const csv = [
      HEADERS,
      "SKU-1,Widget,10,2,3,4,Example",
      "sku-1,Other Widget,20,3,4,5,Example",
    ].join("\n");

    expectValidationCode(csv, "DUPLICATE_SKU");
  });

  it("rejects files over the byte limit before parsing", () => {
    const csv = `${HEADERS}\nSKU-1,Widget,10,2,3,4,Example`;

    expect(() => parseInventoryCsv(csv, { maxBytes: 20 })).toThrowError(
      expect.objectContaining({
        issues: expect.arrayContaining([
          expect.objectContaining({ code: "FILE_TOO_LARGE" }),
        ]),
      }),
    );
  });

  it("rejects files over the row limit", () => {
    const csv = [
      HEADERS,
      "SKU-1,Widget,10,2,3,4,Example",
      "SKU-2,Other Widget,20,3,4,5,Example",
    ].join("\n");

    expect(() => parseInventoryCsv(csv, { maxRows: 1 })).toThrowError(
      expect.objectContaining({
        issues: expect.arrayContaining([
          expect.objectContaining({ code: "TOO_MANY_ROWS" }),
        ]),
      }),
    );
  });

  it("rejects malformed CSV and forbidden control characters", () => {
    expectValidationCode(
      `${HEADERS}\nSKU-1,"unterminated,10,2,3,4,Example`,
      "MALFORMED_CSV",
    );
    expectValidationCode(
      `${HEADERS}\nSKU-1,Widget\u0000,10,2,3,4,Example`,
      "UNSAFE_CONTROL_CHARACTER",
    );
  });

  it("treats formula-like text as inert data", () => {
    const csv = `${HEADERS}\nSKU-1,=2+2,10,2,3,4,@supplier`;

    expect(parseInventoryCsv(csv)[0]).toEqual(
      expect.objectContaining({ productName: "=2+2", supplier: "@supplier" }),
    );
  });
});
