import Papa from "papaparse";

import {
  INVENTORY_CSV_HEADERS,
  type InventoryCsvHeader,
  type InventoryItem,
} from "./types";

export const DEFAULT_MAX_CSV_BYTES = 1_048_576;
export const DEFAULT_MAX_CSV_ROWS = 10_000;

const FORBIDDEN_CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const NON_NEGATIVE_DECIMAL = /^\d+(?:\.\d+)?$/;
const TEXT_LIMITS: Record<"sku" | "product_name" | "supplier", number> = {
  sku: 64,
  product_name: 256,
  supplier: 256,
};

export type InventoryCsvIssueCode =
  | "INVALID_INPUT"
  | "EMPTY_FILE"
  | "FILE_TOO_LARGE"
  | "TOO_MANY_ROWS"
  | "MALFORMED_CSV"
  | "INVALID_HEADERS"
  | "INVALID_ROW"
  | "MISSING_VALUE"
  | "INVALID_NUMBER"
  | "VALUE_TOO_LONG"
  | "DUPLICATE_SKU"
  | "UNSAFE_CONTROL_CHARACTER";

export interface InventoryCsvValidationIssue {
  code: InventoryCsvIssueCode;
  message: string;
  row?: number;
  field?: InventoryCsvHeader;
  value?: string;
}

export interface InventoryCsvParserOptions {
  maxBytes?: number;
  maxRows?: number;
}

export class InventoryCsvValidationError extends Error {
  readonly issues: readonly InventoryCsvValidationIssue[];

  constructor(issues: readonly InventoryCsvValidationIssue[]) {
    super(
      `Inventory CSV validation failed with ${issues.length} issue${issues.length === 1 ? "" : "s"}.`,
    );
    this.name = "InventoryCsvValidationError";
    this.issues = issues;
  }
}

function assertPositiveIntegerLimit(value: number, optionName: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${optionName} must be a positive safe integer.`);
  }
}

function normalizeHeaders(headerRow: readonly string[]): string[] {
  return headerRow.map((header, index) =>
    (index === 0 ? header.replace(/^\uFEFF/, "") : header).trim(),
  );
}

function validateHeaders(headers: readonly string[]): InventoryCsvValidationIssue[] {
  const issues: InventoryCsvValidationIssue[] = [];
  const duplicateHeaders = headers.filter(
    (header, index) => headers.indexOf(header) !== index,
  );
  const missingHeaders = INVENTORY_CSV_HEADERS.filter(
    (header) => !headers.includes(header),
  );
  const unexpectedHeaders = headers.filter(
    (header) =>
      !INVENTORY_CSV_HEADERS.includes(header as InventoryCsvHeader),
  );

  if (
    headers.length !== INVENTORY_CSV_HEADERS.length ||
    duplicateHeaders.length > 0 ||
    missingHeaders.length > 0 ||
    unexpectedHeaders.length > 0
  ) {
    const details = [
      missingHeaders.length > 0
        ? `missing: ${missingHeaders.join(", ")}`
        : null,
      unexpectedHeaders.length > 0
        ? `unexpected: ${unexpectedHeaders.join(", ")}`
        : null,
      duplicateHeaders.length > 0
        ? `duplicate: ${[...new Set(duplicateHeaders)].join(", ")}`
        : null,
    ].filter((detail): detail is string => detail !== null);

    issues.push({
      code: "INVALID_HEADERS",
      message: `CSV headers must contain each required inventory column exactly once${
        details.length > 0 ? ` (${details.join("; ")})` : ""
      }.`,
      row: 1,
    });
  }

  return issues;
}

function parseNonNegativeNumber(
  rawValue: string,
  field: InventoryCsvHeader,
  row: number,
  issues: InventoryCsvValidationIssue[],
): number | undefined {
  if (!NON_NEGATIVE_DECIMAL.test(rawValue)) {
    issues.push({
      code: "INVALID_NUMBER",
      message: `${field} must be a non-negative decimal number.`,
      row,
      field,
      value: rawValue,
    });
    return undefined;
  }

  const value = Number(rawValue);
  const underflowedToZero = value === 0 && /[1-9]/.test(rawValue);

  if (
    !Number.isFinite(value) ||
    value > Number.MAX_SAFE_INTEGER ||
    underflowedToZero
  ) {
    issues.push({
      code: "INVALID_NUMBER",
      message: `${field} must be finite and no greater than Number.MAX_SAFE_INTEGER.`,
      row,
      field,
      value: rawValue,
    });
    return undefined;
  }

  return value;
}

function getCell(
  row: readonly string[],
  columnIndexes: ReadonlyMap<InventoryCsvHeader, number>,
  field: InventoryCsvHeader,
): string {
  const index = columnIndexes.get(field);
  return index === undefined ? "" : (row[index] ?? "").trim();
}

export function parseInventoryCsv(
  csvText: string,
  options: InventoryCsvParserOptions = {},
): InventoryItem[] {
  if (typeof csvText !== "string") {
    throw new InventoryCsvValidationError([
      {
        code: "INVALID_INPUT",
        message: "Inventory CSV input must be a string.",
      },
    ]);
  }

  const maxBytes = options.maxBytes ?? DEFAULT_MAX_CSV_BYTES;
  const maxRows = options.maxRows ?? DEFAULT_MAX_CSV_ROWS;
  assertPositiveIntegerLimit(maxBytes, "maxBytes");
  assertPositiveIntegerLimit(maxRows, "maxRows");

  if (csvText.trim().length === 0) {
    throw new InventoryCsvValidationError([
      { code: "EMPTY_FILE", message: "Inventory CSV cannot be empty." },
    ]);
  }

  const byteLength = new TextEncoder().encode(csvText).byteLength;
  if (byteLength > maxBytes) {
    throw new InventoryCsvValidationError([
      {
        code: "FILE_TOO_LARGE",
        message: `Inventory CSV is ${byteLength} bytes; the limit is ${maxBytes} bytes.`,
      },
    ]);
  }

  if (FORBIDDEN_CONTROL_CHARACTERS.test(csvText)) {
    throw new InventoryCsvValidationError([
      {
        code: "UNSAFE_CONTROL_CHARACTER",
        message: "Inventory CSV contains a forbidden control character.",
      },
    ]);
  }

  const parsed = Papa.parse<string[]>(csvText, {
    delimiter: ",",
    dynamicTyping: false,
    skipEmptyLines: "greedy",
  });
  const issues: InventoryCsvValidationIssue[] = parsed.errors.map((error) => ({
    code: "MALFORMED_CSV",
    message: error.message,
    row: error.row === undefined ? undefined : error.row + 1,
  }));

  if (parsed.data.length === 0) {
    issues.push({ code: "EMPTY_FILE", message: "Inventory CSV cannot be empty." });
    throw new InventoryCsvValidationError(issues);
  }

  const headers = normalizeHeaders(parsed.data[0] ?? []);
  issues.push(...validateHeaders(headers));

  if (issues.length > 0) {
    throw new InventoryCsvValidationError(issues);
  }

  const dataRows = parsed.data.slice(1);
  if (dataRows.length > maxRows) {
    throw new InventoryCsvValidationError([
      {
        code: "TOO_MANY_ROWS",
        message: `Inventory CSV contains ${dataRows.length} data rows; the limit is ${maxRows}.`,
      },
    ]);
  }

  if (dataRows.length === 0) {
    throw new InventoryCsvValidationError([
      {
        code: "EMPTY_FILE",
        message: "Inventory CSV must contain at least one data row.",
      },
    ]);
  }

  const columnIndexes = new Map<InventoryCsvHeader, number>();
  headers.forEach((header, index) => {
    columnIndexes.set(header as InventoryCsvHeader, index);
  });

  const items: InventoryItem[] = [];
  const seenSkus = new Map<string, number>();

  dataRows.forEach((rawRow, dataRowIndex) => {
    const rowNumber = dataRowIndex + 2;
    const issueCountBeforeRow = issues.length;

    if (rawRow.length !== headers.length) {
      issues.push({
        code: "INVALID_ROW",
        message: `Row ${rowNumber} has ${rawRow.length} columns; expected ${headers.length}.`,
        row: rowNumber,
      });
      return;
    }

    const values = Object.fromEntries(
      INVENTORY_CSV_HEADERS.map((field) => [
        field,
        getCell(rawRow, columnIndexes, field),
      ]),
    ) as Record<InventoryCsvHeader, string>;

    for (const field of INVENTORY_CSV_HEADERS) {
      if (values[field] === "") {
        issues.push({
          code: "MISSING_VALUE",
          message: `${field} is required.`,
          row: rowNumber,
          field,
        });
      }
    }

    for (const field of ["sku", "product_name", "supplier"] as const) {
      if (values[field].length > TEXT_LIMITS[field]) {
        issues.push({
          code: "VALUE_TOO_LONG",
          message: `${field} exceeds the ${TEXT_LIMITS[field]} character limit.`,
          row: rowNumber,
          field,
          value: values[field],
        });
      }
    }

    const normalizedSku = values.sku.toUpperCase();
    if (values.sku !== "") {
      const firstRow = seenSkus.get(normalizedSku);
      if (firstRow !== undefined) {
        issues.push({
          code: "DUPLICATE_SKU",
          message: `SKU ${values.sku} duplicates row ${firstRow}.`,
          row: rowNumber,
          field: "sku",
          value: values.sku,
        });
      } else {
        seenSkus.set(normalizedSku, rowNumber);
      }
    }

    const currentStock = parseNonNegativeNumber(
      values.current_stock,
      "current_stock",
      rowNumber,
      issues,
    );
    const averageDailyDemand = parseNonNegativeNumber(
      values.average_daily_demand,
      "average_daily_demand",
      rowNumber,
      issues,
    );
    const leadTimeDays = parseNonNegativeNumber(
      values.lead_time_days,
      "lead_time_days",
      rowNumber,
      issues,
    );
    const safetyStock = parseNonNegativeNumber(
      values.safety_stock,
      "safety_stock",
      rowNumber,
      issues,
    );

    if (issues.length === issueCountBeforeRow) {
      items.push({
        sku: values.sku,
        productName: values.product_name,
        currentStock: currentStock as number,
        averageDailyDemand: averageDailyDemand as number,
        leadTimeDays: leadTimeDays as number,
        safetyStock: safetyStock as number,
        supplier: values.supplier,
      });
    }
  });

  if (issues.length > 0) {
    throw new InventoryCsvValidationError(issues);
  }

  return items;
}
