import { afterEach, describe, expect, it, vi } from "vitest";

import { GeminiServiceError } from "../../src/lib/agent";
import {
  handleAskRequest,
  MAX_ASK_REQUEST_BYTES,
} from "../../app/api/ask/route";

const INVENTORY_CSV = [
  "sku,product_name,current_stock,average_daily_demand,lead_time_days,safety_stock,supplier",
  "SKU-100,Blue Widget,100,20,7,20,Example Supplier",
].join("\n");

function createRequest(
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request("http://localhost/api/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/ask", () => {
  it("validates and parses input before calling the agent", async () => {
    const ask = vi.fn(async () => ({
      answer: "SKU-100 has a reorder shortfall of 60 units.",
      evidence: [
        {
          tool: "analyze_inventory" as const,
          arguments: { skus: ["SKU-100"] },
          result: { reorderShortfall: 60 },
        },
      ],
      toolCallsUsed: 1,
      responseComplete: true,
      finishReason: "STOP",
    }));

    const response = await handleAskRequest(
      createRequest({
        question: "Should I reorder SKU-100?",
        inventoryCsv: INVENTORY_CSV,
      }),
      { ask },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      answer: "SKU-100 has a reorder shortfall of 60 units.",
      evidence: [
        expect.objectContaining({
          tool: "analyze_inventory",
          result: { reorderShortfall: 60 },
        }),
      ],
      toolCallsUsed: 1,
      responseComplete: true,
      finishReason: "STOP",
    });
    expect(ask).toHaveBeenCalledWith({
      question: "Should I reorder SKU-100?",
      inventory: [
        {
          sku: "SKU-100",
          productName: "Blue Widget",
          currentStock: 100,
          averageDailyDemand: 20,
          leadTimeDays: 7,
          safetyStock: 20,
          supplier: "Example Supplier",
        },
      ],
    });
  });

  it("rejects unsupported media types", async () => {
    const request = new Request("http://localhost/api/ask", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "hello",
    });

    const response = await handleAskRequest(request);

    expect(response.status).toBe(415);
    expect(await response.json()).toEqual({
      error: expect.objectContaining({ code: "UNSUPPORTED_MEDIA_TYPE" }),
    });
  });

  it.each([
    ["invalid JSON", "{", 400, "INVALID_JSON"],
    [
      "missing question",
      JSON.stringify({ inventoryCsv: INVENTORY_CSV }),
      400,
      "INVALID_QUESTION",
    ],
    [
      "unknown request field",
      JSON.stringify({
        question: "Find SKU-100",
        inventoryCsv: INVENTORY_CSV,
        command: "cat .env.local",
      }),
      400,
      "INVALID_REQUEST",
    ],
    [
      "invalid inventory CSV",
      JSON.stringify({ question: "Find SKU-100", inventoryCsv: "bad" }),
      422,
      "INVALID_INVENTORY_CSV",
    ],
  ])("rejects %s", async (_name, body, status, code) => {
    const response = await handleAskRequest(createRequest(body));

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({
      error: expect.objectContaining({ code }),
    });
  });

  it("rejects oversized requests using Content-Length before reading", async () => {
    const response = await handleAskRequest(
      createRequest("{}", {
        "Content-Length": String(MAX_ASK_REQUEST_BYTES + 1),
      }),
    );

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      error: expect.objectContaining({ code: "REQUEST_TOO_LARGE" }),
    });
  });

  it("returns a safe error when the API key is missing", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");

    const response = await handleAskRequest(
      createRequest({
        question: "Find SKU-100",
        inventoryCsv: INVENTORY_CSV,
      }),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: {
        code: "AGENT_NOT_CONFIGURED",
        message: "The inventory agent is not configured.",
      },
    });
  });

  it("sanitizes provider errors returned by the API", async () => {
    const response = await handleAskRequest(
      createRequest({
        question: "Find SKU-100",
        inventoryCsv: INVENTORY_CSV,
      }),
      {
        ask: async () => {
          throw new GeminiServiceError();
        },
      },
    );

    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body).toEqual({
      error: {
        code: "AGENT_PROVIDER_ERROR",
        message: "The inventory agent is temporarily unavailable.",
      },
    });
    expect(JSON.stringify(body)).not.toContain("GEMINI_API_KEY");
  });
});
