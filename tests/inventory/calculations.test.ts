import { describe, expect, it } from "vitest";

import {
  analyzeInventory,
  calculateDaysOfStock,
  calculateReorderPoint,
  calculateStockoutRisk,
  type InventoryItem,
} from "../../src/lib/inventory";

function makeItem(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    sku: "SKU-1",
    productName: "Example Widget",
    currentStock: 100,
    averageDailyDemand: 20,
    leadTimeDays: 7,
    safetyStock: 20,
    supplier: "Example Supplier",
    ...overrides,
  };
}

describe("inventory calculations", () => {
  it("verifies the required worked example", () => {
    const item = makeItem();

    expect(calculateDaysOfStock(100, 20)).toBe(5);
    expect(calculateReorderPoint(20, 7, 20)).toBe(160);

    const [analysis] = analyzeInventory([item]);
    expect(analysis).toEqual(
      expect.objectContaining({
        daysOfStock: 5,
        reorderPoint: 160,
        reorderShortfall: 60,
      }),
    );
    expect(analysis.stockoutRisk.level).toBe("critical");
    expect(analysis.stockoutRisk.values).toEqual(
      expect.objectContaining({
        currentStock: 100,
        averageDailyDemand: 20,
        leadTimeDays: 7,
        safetyStock: 20,
        daysOfStock: 5,
        demandDuringLeadTime: 140,
        reorderPoint: 160,
        reorderShortfall: 60,
      }),
    );
    expect(analysis.stockoutRisk.reasons).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Days of stock (5)"),
        expect.stringContaining("60 units below the reorder point (160)"),
      ]),
    );
  });

  it("returns null days of stock and no demand-driven risk for zero demand", () => {
    const risk = calculateStockoutRisk(
      makeItem({ currentStock: 0, averageDailyDemand: 0 }),
    );

    expect(calculateDaysOfStock(0, 0)).toBeNull();
    expect(risk.level).toBe("none");
    expect(risk.values.daysOfStock).toBeNull();
    expect(risk.reasons[0]).toContain("Average daily demand is 0");
  });

  it("marks zero stock with positive demand as critical", () => {
    const risk = calculateStockoutRisk(makeItem({ currentStock: 0 }));

    expect(risk.level).toBe("critical");
    expect(risk.values.reorderShortfall).toBe(160);
    expect(risk.reasons[0]).toContain("Current stock is 0");
  });

  it("handles zero lead time using safety stock as the reorder point", () => {
    const risk = calculateStockoutRisk(
      makeItem({ currentStock: 10, leadTimeDays: 0, safetyStock: 20 }),
    );

    expect(calculateReorderPoint(20, 0, 20)).toBe(20);
    expect(risk.level).toBe("high");
    expect(risk.values.reorderShortfall).toBe(10);
  });

  it.each([
    ["high", { currentStock: 150 }],
    ["medium", { currentStock: 160 }],
    ["low", { currentStock: 200 }],
    ["none", { currentStock: 400 }],
  ] as const)("assigns %s risk at the defined boundary", (level, overrides) => {
    expect(calculateStockoutRisk(makeItem(overrides)).level).toBe(level);
  });

  it("returns analyses without mutating the source records", () => {
    const item = makeItem({ currentStock: 400 });
    const snapshot = structuredClone(item);

    const analyses = analyzeInventory([item]);

    expect(item).toEqual(snapshot);
    expect(analyses).toHaveLength(1);
    expect(analyses[0]).not.toBe(item);
    expect(analyses[0].reorderShortfall).toBe(0);
  });

  it.each([
    [-1, 10],
    [10, -1],
    [Number.NaN, 10],
    [10, Number.POSITIVE_INFINITY],
  ])(
    "rejects invalid days-of-stock inputs (%s, %s)",
    (currentStock, demand) => {
      expect(() => calculateDaysOfStock(currentStock, demand)).toThrow(
        RangeError,
      );
    },
  );

  it("rejects invalid reorder-point inputs", () => {
    expect(() => calculateReorderPoint(10, -1, 5)).toThrow(RangeError);
    expect(() => calculateReorderPoint(10, 5, Number.NaN)).toThrow(
      RangeError,
    );
  });
});
