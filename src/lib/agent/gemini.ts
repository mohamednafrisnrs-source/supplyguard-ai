import { GoogleGenAI } from "@google/genai";

import { runInventoryAgent } from "./agent";
import type {
  AskInventoryQuestionInput,
  AskInventoryQuestionOptions,
  GeminiModelClient,
  InventoryAgentResult,
} from "./types";

export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";
export const GEMINI_REQUEST_TIMEOUT_MS = 20_000;
export const GEMINI_MAX_ATTEMPTS = 2;

export class MissingGeminiApiKeyError extends Error {
  constructor() {
    super("GEMINI_API_KEY is not configured.");
    this.name = "MissingGeminiApiKeyError";
  }
}

function createModelClient(apiKey: string): GeminiModelClient {
  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      timeout: GEMINI_REQUEST_TIMEOUT_MS,
      retryOptions: {
        attempts: GEMINI_MAX_ATTEMPTS,
        initialDelay: 0.25,
        maxDelay: 0.25,
        expBase: 1,
        jitter: 0,
        httpStatusCodes: [408, 429, 500, 502, 503, 504],
      },
    },
  });
  return {
    generateContent: (parameters) => ai.models.generateContent(parameters),
  };
}

export async function askInventoryQuestion(
  input: AskInventoryQuestionInput,
  options: AskInventoryQuestionOptions = {},
): Promise<InventoryAgentResult> {
  const model =
    options.model?.trim() ||
    process.env.GEMINI_MODEL?.trim() ||
    DEFAULT_GEMINI_MODEL;
  let modelClient = options.modelClient;

  if (modelClient === undefined) {
    const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY;
    if (apiKey === undefined || apiKey.trim().length === 0) {
      throw new MissingGeminiApiKeyError();
    }
    modelClient = createModelClient(apiKey);
  }

  return runInventoryAgent(
    input.question,
    input.inventory,
    modelClient,
    model,
  );
}
