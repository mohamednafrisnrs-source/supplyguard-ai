import type {
  InventoryAnalysis,
  InventoryItem,
  StockoutRiskAssessment,
  StockoutRiskLevel,
  StockoutRiskValues,
} from "./types";

function assertNonNegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative finite number.`);
  }
}

function assertInventoryItem(item: InventoryItem): void {
  assertNonNegativeFinite(item.currentStock, "currentStock");
  assertNonNegativeFinite(item.averageDailyDemand, "averageDailyDemand");
  assertNonNegativeFinite(item.leadTimeDays, "leadTimeDays");
  assertNonNegativeFinite(item.safetyStock, "safetyStock");
}

function assertFiniteResult(value: number, name: string): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} exceeds the supported numeric range.`);
  }
  return value;
}

export function calculateDaysOfStock(
  currentStock: number,
  averageDailyDemand: number,
): number | null {
  assertNonNegativeFinite(currentStock, "currentStock");
  assertNonNegativeFinite(averageDailyDemand, "averageDailyDemand");

  if (averageDailyDemand === 0) {
    return null;
  }

  return assertFiniteResult(
    currentStock / averageDailyDemand,
    "daysOfStock",
  );
}

export function calculateReorderPoint(
  averageDailyDemand: number,
  leadTimeDays: number,
  safetyStock: number,
): number {
  assertNonNegativeFinite(averageDailyDemand, "averageDailyDemand");
  assertNonNegativeFinite(leadTimeDays, "leadTimeDays");
  assertNonNegativeFinite(safetyStock, "safetyStock");

  return assertFiniteResult(
    averageDailyDemand * leadTimeDays + safetyStock,
    "reorderPoint",
  );
}

function calculateRiskLevel(values: StockoutRiskValues): StockoutRiskLevel {
  if (values.averageDailyDemand === 0) {
    return "none";
  }

  if (
    values.currentStock === 0 ||
    (values.daysOfStock !== null &&
      values.daysOfStock <= values.leadTimeDays)
  ) {
    return "critical";
  }

  if (values.currentStock < values.reorderPoint) {
    return "high";
  }

  if (values.currentStock === values.reorderPoint) {
    return "medium";
  }

  if (
    values.leadTimeDays > 0 &&
    values.daysOfStock !== null &&
    values.daysOfStock <= values.leadTimeDays * 2
  ) {
    return "low";
  }

  return "none";
}

function buildRiskReasons(
  level: StockoutRiskLevel,
  values: StockoutRiskValues,
): string[] {
  if (values.averageDailyDemand === 0) {
    return [
      `Average daily demand is 0, so days of stock are not applicable and no demand-driven stockout is projected. Current stock is ${values.currentStock}.`,
    ];
  }

  const reasons: string[] = [];

  if (values.currentStock === 0) {
    reasons.push(
      `Current stock is 0 while average daily demand is ${values.averageDailyDemand}.`,
    );
  } else if (
    values.daysOfStock !== null &&
    values.daysOfStock <= values.leadTimeDays
  ) {
    reasons.push(
      `Days of stock (${values.daysOfStock}) are less than or equal to lead time (${values.leadTimeDays} days).`,
    );
  }

  if (values.reorderShortfall > 0) {
    reasons.push(
      `Current stock (${values.currentStock}) is ${values.reorderShortfall} units below the reorder point (${values.reorderPoint}).`,
    );
  } else if (level === "medium") {
    reasons.push(
      `Current stock (${values.currentStock}) equals the reorder point (${values.reorderPoint}); replenishment is due now.`,
    );
  } else if (level === "low") {
    reasons.push(
      `Current stock is above the reorder point, but ${values.daysOfStock} days of stock are no more than twice the ${values.leadTimeDays}-day lead time.`,
    );
  } else if (level === "none") {
    reasons.push(
      `Current stock (${values.currentStock}) is above the reorder point (${values.reorderPoint}) with sufficient lead-time coverage.`,
    );
  }

  return reasons;
}

export function calculateStockoutRisk(
  item: InventoryItem,
): StockoutRiskAssessment {
  assertInventoryItem(item);

  const daysOfStock = calculateDaysOfStock(
    item.currentStock,
    item.averageDailyDemand,
  );
  const demandDuringLeadTime = assertFiniteResult(
    item.averageDailyDemand * item.leadTimeDays,
    "demandDuringLeadTime",
  );
  const reorderPoint = calculateReorderPoint(
    item.averageDailyDemand,
    item.leadTimeDays,
    item.safetyStock,
  );
  const reorderShortfall = Math.max(0, reorderPoint - item.currentStock);
  const values: StockoutRiskValues = {
    currentStock: item.currentStock,
    averageDailyDemand: item.averageDailyDemand,
    leadTimeDays: item.leadTimeDays,
    safetyStock: item.safetyStock,
    daysOfStock,
    demandDuringLeadTime,
    reorderPoint,
    reorderShortfall,
  };
  const level = calculateRiskLevel(values);

  return {
    level,
    reasons: buildRiskReasons(level, values),
    values,
  };
}

export function analyzeInventory(
  items: readonly InventoryItem[],
): InventoryAnalysis[] {
  return items.map((item) => {
    const stockoutRisk = calculateStockoutRisk(item);

    return {
      ...item,
      daysOfStock: stockoutRisk.values.daysOfStock,
      reorderPoint: stockoutRisk.values.reorderPoint,
      reorderShortfall: stockoutRisk.values.reorderShortfall,
      stockoutRisk,
    };
  });
}
