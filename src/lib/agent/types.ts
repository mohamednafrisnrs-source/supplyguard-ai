import type {
  GenerateContentParameters,
  GenerateContentResponse,
} from "@google/genai";

import type { InventoryItem } from "../inventory";

export const INVENTORY_TOOL_NAMES = [
  "search_inventory",
  "analyze_inventory",
] as const;

export type InventoryToolName = (typeof INVENTORY_TOOL_NAMES)[number];

export interface GeminiModelClient {
  generateContent(
    parameters: GenerateContentParameters,
  ): Promise<GenerateContentResponse>;
}

export interface SearchInventoryArgs {
  query: string;
  limit?: number;
}

export interface AnalyzeInventoryArgs {
  skus: string[];
}

export interface ToolError {
  code:
    | "UNKNOWN_TOOL"
    | "INVALID_ARGUMENTS"
    | "TOOL_CALL_LIMIT_REACHED";
  message: string;
}

export type InventoryToolResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: ToolError };

export interface AgentEvidence {
  tool: InventoryToolName;
  arguments: Record<string, unknown>;
  result: Record<string, unknown>;
}

export interface InventoryAgentResult {
  answer: string;
  evidence: AgentEvidence[];
  toolCallsUsed: number;
  responseComplete: boolean;
  finishReason: string | null;
}

export interface AskInventoryQuestionInput {
  question: string;
  inventory: readonly InventoryItem[];
}

export interface AskInventoryQuestionOptions {
  apiKey?: string;
  model?: string;
  modelClient?: GeminiModelClient;
}
