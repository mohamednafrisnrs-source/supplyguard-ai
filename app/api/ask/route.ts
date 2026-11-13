import {
  askInventoryQuestion,
  GeminiServiceError,
  MAX_QUESTION_CHARACTERS,
  MissingGeminiApiKeyError,
  type AskInventoryQuestionInput,
  type InventoryAgentResult,
} from "../../../src/lib/agent";
import {
  InventoryCsvValidationError,
  parseInventoryCsv,
} from "../../../src/lib/inventory";

export const MAX_ASK_REQUEST_BYTES = 1_310_720;

const FORBIDDEN_QUESTION_CHARACTERS =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

type AskFunction = (
  input: AskInventoryQuestionInput,
) => Promise<InventoryAgentResult>;

export interface AskRouteDependencies {
  ask?: AskFunction;
}

interface AskRequestBody {
  question: string;
  inventoryCsv: string;
}

class AskRequestError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "AskRequestError";
    this.code = code;
    this.status = status;
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

async function readBodyWithLimit(request: Request): Promise<string> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && /^\d+$/.test(contentLength)) {
    const declaredLength = Number(contentLength);
    if (declaredLength > MAX_ASK_REQUEST_BYTES) {
      throw new AskRequestError(
        "REQUEST_TOO_LARGE",
        `Request body exceeds the ${MAX_ASK_REQUEST_BYTES}-byte limit.`,
        413,
      );
    }
  }

  if (request.body === null) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;

    if (totalBytes > MAX_ASK_REQUEST_BYTES) {
      await reader.cancel();
      throw new AskRequestError(
        "REQUEST_TOO_LARGE",
        `Request body exceeds the ${MAX_ASK_REQUEST_BYTES}-byte limit.`,
        413,
      );
    }

    chunks.push(value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new AskRequestError(
      "INVALID_ENCODING",
      "Request body must be valid UTF-8.",
      400,
    );
  }
}

function validateRequestBody(value: unknown): AskRequestBody {
  if (!isPlainRecord(value)) {
    throw new AskRequestError(
      "INVALID_REQUEST",
      "Request body must be a JSON object.",
      400,
    );
  }

  const keys = Object.keys(value);
  if (
    keys.some((key) => key !== "question" && key !== "inventoryCsv")
  ) {
    throw new AskRequestError(
      "INVALID_REQUEST",
      "Request body accepts only question and inventoryCsv.",
      400,
    );
  }

  if (typeof value.question !== "string") {
    throw new AskRequestError(
      "INVALID_QUESTION",
      "question must be a string.",
      400,
    );
  }

  const question = value.question.trim();
  if (
    question.length === 0 ||
    question.length > MAX_QUESTION_CHARACTERS ||
    FORBIDDEN_QUESTION_CHARACTERS.test(question)
  ) {
    throw new AskRequestError(
      "INVALID_QUESTION",
      `question must contain 1 to ${MAX_QUESTION_CHARACTERS} characters.`,
      400,
    );
  }

  if (typeof value.inventoryCsv !== "string") {
    throw new AskRequestError(
      "INVALID_INVENTORY",
      "inventoryCsv must be a CSV string.",
      400,
    );
  }

  return { question, inventoryCsv: value.inventoryCsv };
}

export async function handleAskRequest(
  request: Request,
  dependencies: AskRouteDependencies = {},
): Promise<Response> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  const mediaType = contentType.split(";", 1)[0]?.trim();
  if (mediaType !== "application/json") {
    return jsonResponse(
      {
        error: {
          code: "UNSUPPORTED_MEDIA_TYPE",
          message: "Content-Type must be application/json.",
        },
      },
      415,
    );
  }

  try {
    const bodyText = await readBodyWithLimit(request);
    let parsedBody: unknown;

    try {
      parsedBody = JSON.parse(bodyText);
    } catch {
      throw new AskRequestError(
        "INVALID_JSON",
        "Request body must contain valid JSON.",
        400,
      );
    }

    const body = validateRequestBody(parsedBody);
    const inventory = parseInventoryCsv(body.inventoryCsv);
    const ask = dependencies.ask ?? askInventoryQuestion;
    const result = await ask({ question: body.question, inventory });

    return jsonResponse(result);
  } catch (error) {
    if (error instanceof AskRequestError) {
      return jsonResponse(
        { error: { code: error.code, message: error.message } },
        error.status,
      );
    }

    if (error instanceof InventoryCsvValidationError) {
      return jsonResponse(
        {
          error: {
            code: "INVALID_INVENTORY_CSV",
            message: "Inventory CSV validation failed.",
            issues: error.issues,
          },
        },
        422,
      );
    }

    if (error instanceof MissingGeminiApiKeyError) {
      return jsonResponse(
        {
          error: {
            code: "AGENT_NOT_CONFIGURED",
            message: "The inventory agent is not configured.",
          },
        },
        503,
      );
    }

    if (error instanceof GeminiServiceError) {
      return jsonResponse(
        {
          error: {
            code: "AGENT_PROVIDER_ERROR",
            message: "The inventory agent is temporarily unavailable.",
          },
        },
        502,
      );
    }

    return jsonResponse(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "The request could not be completed.",
        },
      },
      500,
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  return handleAskRequest(request);
}
