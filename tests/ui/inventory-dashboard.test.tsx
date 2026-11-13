// @vitest-environment jsdom

import { readFileSync } from "node:fs";

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InventoryDashboard } from "../../src/components/inventory-dashboard";

const SAMPLE_CSV = [
  "sku,product_name,current_stock,average_daily_demand,lead_time_days,safety_stock,supplier",
  "SKU-CRIT,Critical Widget,10,10,2,5,North Supplier",
  "SKU-SAFE,Healthy Widget,100,5,2,10,South Supplier",
  "SKU-DUE,Due Widget,20,5,2,10,East Supplier",
].join("\n");

function response(body: unknown, ok = true) {
  const normalizedBody =
    body !== null && typeof body === "object" && "answer" in body
      ? { responseComplete: true, finishReason: "STOP", ...body }
      : body;
  return {
    ok,
    json: vi.fn().mockResolvedValue(normalizedBody),
  } as unknown as Response;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("InventoryDashboard", () => {
  it("derives KPI cards and searchable table values from validated inventory", () => {
    render(<InventoryDashboard sampleCsv={SAMPLE_CSV} />);

    const totalCard = screen.getByText("Total products").closest("article");
    const criticalCard = screen
      .getByText("Critical products")
      .closest("article");
    const reorderCard = screen.getByText("Require reorder").closest("article");

    expect(totalCard?.textContent).toContain("3");
    expect(criticalCard?.textContent).toContain("1");
    expect(reorderCard?.textContent).toContain("2");
    expect(screen.getByText("Critical Widget")).toBeDefined();

    const criticalRow = screen.getByText("SKU-CRIT").closest("tr");
    expect(criticalRow).not.toBeNull();
    expect(criticalRow?.textContent).toContain("10");
    expect(criticalRow?.textContent).toContain("1d");
    expect(criticalRow?.textContent).toContain("25");
    expect(criticalRow?.textContent).toContain("15");
    expect(criticalRow?.textContent).toContain("Critical");

    fireEvent.change(screen.getByLabelText("Search inventory"), {
      target: { value: "south supplier" },
    });

    expect(screen.getByText("1 of 3 products")).toBeDefined();
    expect(screen.getByText("Healthy Widget")).toBeDefined();
    expect(screen.queryByText("Critical Widget")).toBeNull();
  });

  it("matches dashboard KPIs to calculations from the repository sample", () => {
    const repositoryCsv = readFileSync("src/data/inventory.csv", "utf8");
    render(<InventoryDashboard sampleCsv={repositoryCsv} />);

    expect(
      screen.getByText("Total products").closest("article")?.textContent,
    ).toContain("15");
    expect(
      screen.getByText("Critical products").closest("article")?.textContent,
    ).toContain("6");
    expect(
      screen.getByText("Require reorder").closest("article")?.textContent,
    ).toContain("11");
  });

  it("warns when the provider reports an incomplete answer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        response({
          answer: "Partial grounded answer.\n\nResponse incomplete.",
          evidence: [
            {
              tool: "analyze_inventory",
              arguments: { skus: ["SKU-CRIT"] },
              result: { analyses: [{ sku: "SKU-CRIT" }] },
            },
          ],
          toolCallsUsed: 1,
          responseComplete: false,
          finishReason: "MAX_TOKENS",
        }),
      ),
    );
    render(<InventoryDashboard sampleCsv={SAMPLE_CSV} />);

    fireEvent.click(
      screen.getByRole("button", { name: "Which products are critical?" }),
    );

    expect(
      await screen.findByText(/This answer may be incomplete \(MAX_TOKENS\)/),
    ).toBeDefined();
    expect(screen.getByText("analyze_inventory")).toBeDefined();
  });

  it("posts the active CSV and renders grounded answer, evidence, and tool details", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      response({
        answer: "SKU-CRIT is critical with 1 day of stock and a 15-unit shortfall.",
        evidence: [
          {
            tool: "analyze_inventory",
            arguments: { skus: ["SKU-CRIT"] },
            result: {
              analyses: [
                {
                  sku: "SKU-CRIT",
                  daysOfStock: 1,
                  reorderPoint: 25,
                  reorderShortfall: 15,
                },
              ],
            },
          },
        ],
        toolCallsUsed: 1,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<InventoryDashboard sampleCsv={SAMPLE_CSV} />);

    fireEvent.click(
      screen.getByRole("button", { name: "Which products are critical?" }),
    );

    expect(
      await screen.findByText(
        "SKU-CRIT is critical with 1 day of stock and a 15-unit shortfall.",
      ),
    ).toBeDefined();
    expect(screen.getByText("1 tool call · 1 evidence item")).toBeDefined();
    expect(screen.getByText("analyze_inventory")).toBeDefined();
    expect(screen.getByText(/"reorderShortfall": 15/)).toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, options] = fetchMock.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/api/ask");
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body as string)).toEqual({
      question: "Which products are critical?",
      inventoryCsv: SAMPLE_CSV,
    });
  });

  it("renders model text as text and surfaces sanitized API errors", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          answer: '<img src=x onerror="alert(1)"> SKU-CRIT',
          evidence: [
            {
              tool: "search_inventory",
              arguments: { query: "SKU-CRIT" },
              result: { items: [{ sku: "SKU-CRIT" }] },
            },
          ],
          toolCallsUsed: 1,
        }),
      )
      .mockResolvedValueOnce(
        response(
          {
            error: {
              code: "AGENT_PROVIDER_ERROR",
              message: "The inventory agent is temporarily unavailable.",
            },
          },
          false,
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(
      <InventoryDashboard sampleCsv={SAMPLE_CSV} />,
    );

    const input = screen.getByLabelText("Ask a question about this inventory");
    fireEvent.change(input, { target: { value: "Find SKU-CRIT" } });
    fireEvent.click(screen.getByRole("button", { name: "Send question" }));

    expect(
      await screen.findByText('<img src=x onerror="alert(1)"> SKU-CRIT'),
    ).toBeDefined();
    expect(container.querySelector("img")).toBeNull();

    fireEvent.change(input, { target: { value: "Try again" } });
    fireEvent.click(screen.getByRole("button", { name: "Send question" }));
    expect(
      await screen.findByText(
        "The inventory agent is temporarily unavailable.",
      ),
    ).toBeDefined();
  });

  it("clears previous answers and recalculates when a new CSV is uploaded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        response({
          answer: "Old dataset answer for SKU-CRIT.",
          evidence: [
            {
              tool: "search_inventory",
              arguments: { query: "SKU-CRIT" },
              result: { items: [{ sku: "SKU-CRIT" }] },
            },
          ],
          toolCallsUsed: 1,
        }),
      ),
    );
    render(<InventoryDashboard sampleCsv={SAMPLE_CSV} />);

    fireEvent.click(
      screen.getByRole("button", { name: "Which products are critical?" }),
    );
    expect(
      await screen.findByText("Old dataset answer for SKU-CRIT."),
    ).toBeDefined();

    const newCsv = [
      "sku,product_name,current_stock,average_daily_demand,lead_time_days,safety_stock,supplier",
      "SKU-NEW,New Product,50,5,2,10,New Supplier",
    ].join("\n");
    const file = new File([newCsv], "replacement.csv", { type: "text/csv" });
    Object.defineProperty(file, "text", {
      value: vi.fn().mockResolvedValue(newCsv),
    });
    const upload = screen.getByLabelText("Upload CSV");
    fireEvent.change(upload, { target: { files: [file] } });

    expect(
      await screen.findByText(
        "Inventory changed. Previous answers and evidence were cleared.",
      ),
    ).toBeDefined();
    expect(screen.queryByText("Old dataset answer for SKU-CRIT.")).toBeNull();
    expect(screen.getByText("New Product")).toBeDefined();
    const totalCard = screen.getByText("Total products").closest("article");
    expect(totalCard).not.toBeNull();
    expect(within(totalCard as HTMLElement).getByText("1")).toBeDefined();
  });

  it("rejects an invalid uploaded CSV without replacing current inventory", async () => {
    render(<InventoryDashboard sampleCsv={SAMPLE_CSV} />);
    const file = new File(["bad"], "bad.csv", { type: "text/csv" });
    Object.defineProperty(file, "text", {
      value: vi.fn().mockResolvedValue("bad"),
    });

    fireEvent.change(screen.getByLabelText("Upload CSV"), {
      target: { files: [file] },
    });

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("CSV headers");
    });
    expect(screen.getByText("Critical Widget")).toBeDefined();
  });
});
