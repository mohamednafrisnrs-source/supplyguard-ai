export const INVENTORY_CSV_HEADERS = [
  "sku",
  "product_name",
  "current_stock",
  "average_daily_demand",
  "lead_time_days",
  "safety_stock",
  "supplier",
] as const;

export type InventoryCsvHeader = (typeof INVENTORY_CSV_HEADERS)[number];

export interface InventoryCsvRow {
  sku: string;
  product_name: string;
  current_stock: string;
  average_daily_demand: string;
  lead_time_days: string;
  safety_stock: string;
  supplier: string;
}

export interface InventoryItem {
  sku: string;
  productName: string;
  currentStock: number;
  averageDailyDemand: number;
  leadTimeDays: number;
  safetyStock: number;
  supplier: string;
}

export type StockoutRiskLevel =
  | "none"
  | "low"
  | "medium"
  | "high"
  | "critical";

export interface StockoutRiskValues {
  currentStock: number;
  averageDailyDemand: number;
  leadTimeDays: number;
  safetyStock: number;
  daysOfStock: number | null;
  demandDuringLeadTime: number;
  reorderPoint: number;
  reorderShortfall: number;
}

export interface StockoutRiskAssessment {
  level: StockoutRiskLevel;
  reasons: string[];
  values: StockoutRiskValues;
}

export interface InventoryAnalysis extends InventoryItem {
  daysOfStock: number | null;
  reorderPoint: number;
  reorderShortfall: number;
  stockoutRisk: StockoutRiskAssessment;
}
