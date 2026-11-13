import type { FunctionCall, FunctionDeclaration } from "@google/genai";

import { analyzeInventory, type InventoryItem } from "../inventory";
import {
  INVENTORY_TOOL_NAMES,
  type AnalyzeInventoryArgs,
  type InventoryToolName,
  type InventoryToolResult,
  type SearchInventoryArgs,
} from "./types";

export const MAX_SEARCH_RESULTS = 20;
export const MAX_ANALYZE_SKUS = 20;

export const INVENTORY_FUNCTION_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: "search_inventory",
    description:
      "Search inventory by SKU, product name, or supplier. Use '*' to list inventory. Returns actual inventory records only.",
    parametersJsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: {
          type: "string",
          minLength: 1,
          maxLength: 120,
          description:
            "Case-insensitive SKU, product, or supplier search text. Use '*' to list records.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: MAX_SEARCH_RESULTS,
          description: "Maximum records to return. Defaults to 10.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "analyze_inventory",
    description:
      "Calculate days of stock, reorder point, reorder shortfall, and stockout risk for exact inventory SKUs.",
    parametersJsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        skus: {
          type: "array",
          minItems: 1,
          maxItems: MAX_ANALYZE_SKUS,
          items: { type: "string", minLength: 1, maxLength: 64 },
          description: "One or more exact SKUs returned by search_inventory.",
        },
      },
      required: ["skus"],
    },
  },
];

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
): boolean {
  return Object.keys(value).every((key) => allowedKeys.includes(key));
}

function invalidArguments(message: string): InventoryToolResult {
  return {
    ok: false,
    error: { code: "INVALID_ARGUMENTS", message },
  };
}

function validateSearchArguments(
  args: unknown,
): SearchInventoryArgs | InventoryToolResult {
  if (!isPlainRecord(args) || !hasOnlyKeys(args, ["query", "limit"])) {
    return invalidArguments(
      "search_inventory accepts only query and optional limit arguments.",
    );
  }

  if (typeof args.query !== "string") {
    return invalidArguments("search_inventory query must be a string.");
  }

  const query = args.query.trim();
  if (query.length === 0 || query.length > 120) {
    return invalidArguments(
      "search_inventory query must contain 1 to 120 characters.",
    );
  }

  if (
    args.limit !== undefined &&
    (!Number.isInteger(args.limit) ||
      (args.limit as number) < 1 ||
      (args.limit as number) > MAX_SEARCH_RESULTS)
  ) {
    return invalidArguments(
      `search_inventory limit must be an integer from 1 to ${MAX_SEARCH_RESULTS}.`,
    );
  }

  return { query, limit: args.limit as number | undefined };
}

function validateAnalyzeArguments(
  args: unknown,
): AnalyzeInventoryArgs | InventoryToolResult {
  if (!isPlainRecord(args) || !hasOnlyKeys(args, ["skus"])) {
    return invalidArguments("analyze_inventory accepts only a skus argument.");
  }

  if (
    !Array.isArray(args.skus) ||
    args.skus.length === 0 ||
    args.skus.length > MAX_ANALYZE_SKUS
  ) {
    return invalidArguments(
      `analyze_inventory skus must contain 1 to ${MAX_ANALYZE_SKUS} values.`,
    );
  }

  const skus: string[] = [];
  const seen = new Set<string>();

  for (const rawSku of args.skus) {
    if (typeof rawSku !== "string") {
      return invalidArguments("Every analyze_inventory SKU must be a string.");
    }

    const sku = rawSku.trim();
    if (sku.length === 0 || sku.length > 64) {
      return invalidArguments(
        "Every analyze_inventory SKU must contain 1 to 64 characters.",
      );
    }

    const normalizedSku = sku.toUpperCase();
    if (!seen.has(normalizedSku)) {
      seen.add(normalizedSku);
      skus.push(sku);
    }
  }

  return { skus };
}

function searchInventory(
  args: SearchInventoryArgs,
  inventory: readonly InventoryItem[],
): Record<string, unknown> {
  const normalizedQuery = args.query.toLocaleLowerCase("en-US");
  const limit = args.limit ?? 10;
  const listAll = normalizedQuery === "*" || normalizedQuery === "all";

  const scoredMatches = inventory
    .map((item, originalIndex) => {
      const sku = item.sku.toLocaleLowerCase("en-US");
      const productName = item.productName.toLocaleLowerCase("en-US");
      const supplier = item.supplier.toLocaleLowerCase("en-US");
      let score = Number.POSITIVE_INFINITY;

      if (listAll) score = 5;
      else if (sku === normalizedQuery) score = 0;
      else if (sku.startsWith(normalizedQuery)) score = 1;
      else if (sku.includes(normalizedQuery)) score = 2;
      else if (productName.startsWith(normalizedQuery)) score = 3;
      else if (productName.includes(normalizedQuery)) score = 4;
      else if (supplier.includes(normalizedQuery)) score = 5;

      return { item, originalIndex, score };
    })
    .filter(({ score }) => Number.isFinite(score))
    .sort((left, right) =>
      left.score === right.score
        ? left.originalIndex - right.originalIndex
        : left.score - right.score,
    );

  return {
    query: args.query,
    totalMatches: scoredMatches.length,
    returnedCount: Math.min(scoredMatches.length, limit),
    items: scoredMatches.slice(0, limit).map(({ item }) => ({ ...item })),
  };
}

function analyzeSelectedInventory(
  args: AnalyzeInventoryArgs,
  inventory: readonly InventoryItem[],
): Record<string, unknown> {
  const itemsBySku = new Map(
    inventory.map((item) => [item.sku.toUpperCase(), item] as const),
  );
  const foundItems: InventoryItem[] = [];
  const missingSkus: string[] = [];

  for (const sku of args.skus) {
    const item = itemsBySku.get(sku.toUpperCase());
    if (item === undefined) missingSkus.push(sku);
    else foundItems.push(item);
  }

  return {
    requestedSkus: args.skus,
    missingSkus,
    analyses: analyzeInventory(foundItems),
  };
}

export function isInventoryToolName(name: string): name is InventoryToolName {
  return INVENTORY_TOOL_NAMES.includes(name as InventoryToolName);
}

export function executeInventoryToolCall(
  call: FunctionCall,
  inventory: readonly InventoryItem[],
): InventoryToolResult {
  const name = call.name;
  if (name === undefined || !isInventoryToolName(name)) {
    return {
      ok: false,
      error: {
        code: "UNKNOWN_TOOL",
        message: "The requested tool is not supported.",
      },
    };
  }

  if (name === "search_inventory") {
    const args = validateSearchArguments(call.args);
    if ("ok" in args) return args;
    return { ok: true, data: searchInventory(args, inventory) };
  }

  const args = validateAnalyzeArguments(call.args);
  if ("ok" in args) return args;
  return { ok: true, data: analyzeSelectedInventory(args, inventory) };
}
