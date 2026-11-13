"use client";

import {
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
  useMemo,
  useRef,
  useState,
} from "react";

import type { AgentEvidence } from "../lib/agent/types";
import {
  analyzeInventory,
  DEFAULT_MAX_CSV_BYTES,
  InventoryCsvValidationError,
  parseInventoryCsv,
  type InventoryAnalysis,
  type StockoutRiskLevel,
} from "../lib/inventory";

const SAMPLE_NAME = "Synthetic sample · 15 products";
const SUGGESTED_QUESTIONS = [
  "Which products are critical?",
  "Which products need reordering?",
  "Show the largest reorder shortfalls.",
] as const;

type IconName =
  | "box"
  | "chat"
  | "chevron"
  | "critical"
  | "database"
  | "file"
  | "reorder"
  | "search"
  | "send"
  | "shield"
  | "spark"
  | "upload";

interface DatasetState {
  csv: string;
  label: string;
  analyses: InventoryAnalysis[];
}

interface AssistantMessage {
  id: number;
  role: "assistant";
  text: string;
  evidence: AgentEvidence[];
  toolCallsUsed: number;
  responseComplete: boolean;
  finishReason: string | null;
}

interface UserMessage {
  id: number;
  role: "user";
  text: string;
}

type ChatMessage = AssistantMessage | UserMessage;

interface ApiErrorBody {
  error?: { message?: unknown };
}

interface ApiSuccessBody {
  answer: string;
  evidence: AgentEvidence[];
  toolCallsUsed: number;
  responseComplete: boolean;
  finishReason: string | null;
}

export interface InventoryDashboardProps {
  sampleCsv: string;
}

function Icon({
  name,
  className = "h-5 w-5",
}: {
  name: IconName;
  className?: string;
}) {
  const paths: Record<IconName, ReactNode> = {
    box: (
      <>
        <path d="m21 8-9 5-9-5" />
        <path d="M3 8l9-5 9 5v8l-9 5-9-5Z" />
        <path d="M12 13v8" />
      </>
    ),
    chat: (
      <>
        <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z" />
        <path d="M8 9h8M8 13h5" />
      </>
    ),
    chevron: <path d="m9 18 6-6-6-6" />,
    critical: (
      <>
        <path d="M12 3 2.8 19h18.4Z" />
        <path d="M12 9v4M12 17h.01" />
      </>
    ),
    database: (
      <>
        <ellipse cx="12" cy="5" rx="8" ry="3" />
        <path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
      </>
    ),
    file: (
      <>
        <path d="M14 2H6a2 2 0 0 0-2 2v16h16V8Z" />
        <path d="M14 2v6h6M8 13h8M8 17h6" />
      </>
    ),
    reorder: (
      <>
        <path d="M20 7h-9a4 4 0 0 0-4 4v9" />
        <path d="m16 3 4 4-4 4M4 17l3 3 3-3" />
      </>
    ),
    search: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-4-4" />
      </>
    ),
    send: (
      <>
        <path d="m22 2-7 20-4-9-9-4Z" />
        <path d="M22 2 11 13" />
      </>
    ),
    shield: (
      <>
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
        <path d="m9 12 2 2 4-5" />
      </>
    ),
    spark: (
      <>
        <path d="m12 3 1.3 4.2L17 9l-3.7 1.8L12 15l-1.3-4.2L7 9l3.7-1.8Z" />
        <path d="m19 15 .7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7Z" />
      </>
    ),
    upload: (
      <>
        <path d="M12 16V4M7 9l5-5 5 5" />
        <path d="M4 15v5h16v-5" />
      </>
    ),
  };

  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      {paths[name]}
    </svg>
  );
}

function makeDataset(csv: string, label: string): DatasetState {
  const inventory = parseInventoryCsv(csv);
  return { csv, label, analyses: analyzeInventory(inventory) };
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDays(value: number | null): string {
  return value === null ? "N/A" : `${formatNumber(value)}d`;
}

function riskLabel(level: StockoutRiskLevel): string {
  return level === "none"
    ? "Healthy"
    : `${level[0]?.toUpperCase()}${level.slice(1)}`;
}

function riskClasses(level: StockoutRiskLevel): string {
  return {
    critical: "bg-red-50 text-red-700 ring-red-200",
    high: "bg-orange-50 text-orange-700 ring-orange-200",
    medium: "bg-amber-50 text-amber-700 ring-amber-200",
    low: "bg-sky-50 text-sky-700 ring-sky-200",
    none: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  }[level];
}

function parseErrorMessage(error: unknown): string {
  if (error instanceof InventoryCsvValidationError) {
    const first = error.issues[0];
    return first === undefined
      ? "The CSV could not be validated."
      : `${first.message}${first.row === undefined ? "" : ` (row ${first.row})`}`;
  }
  return "The CSV could not be loaded. Check the file and try again.";
}

function isSuccessBody(value: unknown): value is ApiSuccessBody {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const body = value as Record<string, unknown>;
  return (
    typeof body.answer === "string" &&
    Array.isArray(body.evidence) &&
    Number.isInteger(body.toolCallsUsed) &&
    (body.toolCallsUsed as number) >= 0 &&
    typeof body.responseComplete === "boolean" &&
    (body.finishReason === null || typeof body.finishReason === "string")
  );
}

function getApiError(value: unknown): string | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const message = (value as ApiErrorBody).error?.message;
  return typeof message === "string" ? message : undefined;
}

function KpiCard({
  icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: IconName;
  label: string;
  value: number;
  detail: string;
  tone: "teal" | "red" | "amber";
}) {
  const tones = {
    teal: "bg-emerald-50 text-emerald-700",
    red: "bg-red-50 text-red-700",
    amber: "bg-amber-50 text-amber-700",
  };

  return (
    <article className="relative overflow-hidden rounded-2xl border border-[#dde3df] bg-white p-5 shadow-[0_1px_2px_rgba(15,35,30,.04)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-bold tracking-[0.14em] text-[#6d7975] uppercase">
            {label}
          </p>
          <p className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-[#14201d]">
            {value}
          </p>
          <p className="mt-1 text-xs text-[#75817d]">{detail}</p>
        </div>
        <span
          className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${tones[tone]}`}
        >
          <Icon className="h-5 w-5" name={icon} />
        </span>
      </div>
    </article>
  );
}

export function InventoryDashboard({ sampleCsv }: InventoryDashboardProps) {
  const [dataset, setDataset] = useState(() =>
    makeDataset(sampleCsv, SAMPLE_NAME),
  );
  const [search, setSearch] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const [datasetNotice, setDatasetNotice] = useState<string | null>(null);
  const [isAsking, setIsAsking] = useState(false);
  const requestController = useRef<AbortController | null>(null);
  const revision = useRef(0);
  const messageId = useRef(0);

  const criticalCount = useMemo(
    () =>
      dataset.analyses.filter(
        (item) => item.stockoutRisk.level === "critical",
      ).length,
    [dataset.analyses],
  );
  const reorderCount = useMemo(
    () =>
      dataset.analyses.filter(
        (item) => item.currentStock <= item.reorderPoint,
      ).length,
    [dataset.analyses],
  );
  const visibleInventory = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("en-US");
    if (query.length === 0) return dataset.analyses;
    return dataset.analyses.filter((item) =>
      [item.sku, item.productName, item.supplier, item.stockoutRisk.level].some(
        (value) => value.toLocaleLowerCase("en-US").includes(query),
      ),
    );
  }, [dataset.analyses, search]);

  function replaceDataset(csv: string, label: string): void {
    const nextDataset = makeDataset(csv, label);
    requestController.current?.abort();
    revision.current += 1;
    setDataset(nextDataset);
    setSearch("");
    setMessages([]);
    setChatInput("");
    setChatError(null);
    setUploadError(null);
    setIsAsking(false);
    setDatasetNotice(
      "Inventory changed. Previous answers and evidence were cleared.",
    );
  }

  function loadSample(): void {
    try {
      replaceDataset(sampleCsv, SAMPLE_NAME);
    } catch (error) {
      setUploadError(parseErrorMessage(error));
    }
  }

  async function handleFileChange(
    event: ChangeEvent<HTMLInputElement>,
  ): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file === undefined) return;

    if (file.size > DEFAULT_MAX_CSV_BYTES) {
      setUploadError(
        `CSV files must be ${formatNumber(DEFAULT_MAX_CSV_BYTES)} bytes or smaller.`,
      );
      return;
    }

    try {
      const csv = await file.text();
      replaceDataset(csv, `${file.name} · ${formatNumber(file.size)} bytes`);
    } catch (error) {
      setUploadError(parseErrorMessage(error));
    }
  }

  async function askQuestion(rawQuestion: string): Promise<void> {
    const question = rawQuestion.trim();
    if (question.length === 0 || isAsking) return;

    const requestRevision = revision.current;
    const controller = new AbortController();
    requestController.current?.abort();
    requestController.current = controller;
    setIsAsking(true);
    setChatError(null);
    setDatasetNotice(null);
    setChatInput("");
    setMessages((current) => [
      ...current,
      { id: ++messageId.current, role: "user", text: question },
    ]);

    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, inventoryCsv: dataset.csv }),
        signal: controller.signal,
      });
      const body: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(
          getApiError(body) ??
            "The inventory agent could not answer right now.",
        );
      }
      if (!isSuccessBody(body)) {
        throw new Error("The inventory agent returned an invalid response.");
      }
      if (requestRevision !== revision.current) return;

      setMessages((current) => [
        ...current,
        {
          id: ++messageId.current,
          role: "assistant",
          text: body.answer,
          evidence: body.evidence,
          toolCallsUsed: body.toolCallsUsed,
          responseComplete: body.responseComplete,
          finishReason: body.finishReason,
        },
      ]);
    } catch (error) {
      if (controller.signal.aborted || requestRevision !== revision.current) {
        return;
      }
      setChatError(
        error instanceof Error
          ? error.message
          : "The inventory agent could not answer right now.",
      );
    } finally {
      if (requestRevision === revision.current) setIsAsking(false);
    }
  }

  function submitQuestion(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void askQuestion(chatInput);
  }

  return (
    <div className="min-h-screen bg-transparent lg:grid lg:grid-cols-[232px_minmax(0,1fr)]">
      <aside className="grid-texture hidden min-h-screen bg-[#102b2b] text-white lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col">
        <div className="flex h-[76px] items-center gap-3 border-b border-white/10 px-6">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#c7f36b] text-[#102b2b]">
            <Icon className="h-5 w-5" name="shield" />
          </span>
          <div>
            <p className="font-semibold tracking-[-0.03em]">SupplyGuard</p>
            <p className="text-[9px] font-bold tracking-[0.22em] text-[#a8c4bb] uppercase">
              Inventory AI
            </p>
          </div>
        </div>
        <nav aria-label="Primary" className="px-3 py-6">
          <p className="px-3 text-[10px] font-bold tracking-[0.17em] text-[#76968c] uppercase">
            Workspace
          </p>
          <a
            className="mt-3 flex items-center gap-3 rounded-xl bg-white/10 px-3 py-3 text-sm font-medium text-white"
            href="#overview"
          >
            <Icon className="h-4 w-4 text-[#c7f36b]" name="database" />
            Inventory overview
          </a>
          <a
            className="mt-1 flex items-center gap-3 rounded-xl px-3 py-3 text-sm text-[#b6cbc4] hover:bg-white/5 hover:text-white"
            href="#assistant"
          >
            <Icon className="h-4 w-4" name="chat" /> Ask SupplyGuard
          </a>
        </nav>
        <div className="mt-auto p-4">
          <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#d7e4df]">
              <span className="h-2 w-2 rounded-full bg-[#c7f36b] shadow-[0_0_0_4px_rgba(199,243,107,.12)]" />
              Local data active
            </div>
            <p className="mt-2 text-[11px] leading-5 text-[#8eaaa1]">
              Calculations run from your validated CSV. Gemini keys remain
              server-side.
            </p>
          </div>
          <p className="mt-4 px-1 text-[10px] text-[#6f9186]">
            Open-source inventory intelligence
          </p>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-20 flex h-[68px] items-center justify-between border-b border-[#dce2de] bg-[#f3f5f2]/90 px-4 backdrop-blur-xl sm:px-6 lg:h-[76px] lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#102b2b] text-[#c7f36b] lg:hidden">
              <Icon className="h-5 w-5" name="shield" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-[#172622]">
                Inventory control center
              </p>
              <p className="truncate text-[11px] text-[#72807b]">
                {dataset.label}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="hidden h-10 items-center gap-2 rounded-xl border border-[#d5ddd8] bg-white px-3 text-xs font-semibold text-[#35443f] shadow-sm transition hover:border-[#a8bbb3] sm:flex"
              onClick={loadSample}
              type="button"
            >
              <Icon className="h-4 w-4" name="file" /> Load sample
            </button>
            <label
              className="flex h-10 cursor-pointer items-center gap-2 rounded-xl bg-[#102b2b] px-3.5 text-xs font-semibold text-white shadow-sm transition hover:bg-[#183c3a]"
              htmlFor="inventory-upload"
            >
              <Icon className="h-4 w-4" name="upload" />
              <span className="hidden sm:inline">Upload CSV</span>
            </label>
            <input
              accept=".csv,text/csv"
              className="sr-only"
              id="inventory-upload"
              onChange={(event) => void handleFileChange(event)}
              type="file"
            />
          </div>
        </header>

        <main className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <section id="overview">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
              <div>
                <p className="text-[11px] font-bold tracking-[0.16em] text-[#0f766e] uppercase">
                  Live inventory posture
                </p>
                <h1 className="mt-1 text-2xl font-semibold tracking-[-0.04em] text-[#14201d] sm:text-3xl">
                  Know what needs attention.
                </h1>
                <p className="mt-2 max-w-xl text-sm leading-6 text-[#697671]">
                  Validated stock data, deterministic risk calculations, and
                  grounded AI answers in one workspace.
                </p>
              </div>
              <button
                className="flex h-10 items-center justify-center gap-2 rounded-xl border border-[#d5ddd8] bg-white px-3 text-xs font-semibold text-[#35443f] shadow-sm sm:hidden"
                onClick={loadSample}
                type="button"
              >
                <Icon className="h-4 w-4" name="file" /> Load sample data
              </button>
            </div>

            <div aria-live="polite" className="mt-4 space-y-2">
              {uploadError !== null && (
                <div
                  className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
                  role="alert"
                >
                  {uploadError}
                </div>
              )}
              {datasetNotice !== null && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                  {datasetNotice}
                </div>
              )}
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <KpiCard
                detail="Validated inventory records"
                icon="box"
                label="Total products"
                tone="teal"
                value={dataset.analyses.length}
              />
              <KpiCard
                detail="Coverage at or below lead time"
                icon="critical"
                label="Critical products"
                tone="red"
                value={criticalCount}
              />
              <KpiCard
                detail="Stock at or below reorder point"
                icon="reorder"
                label="Require reorder"
                tone="amber"
                value={reorderCount}
              />
            </div>
          </section>

          <div className="mt-6 grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(360px,.75fr)]">
            <InventoryTable
              analyses={dataset.analyses}
              search={search}
              setSearch={setSearch}
              visibleInventory={visibleInventory}
            />
            <ChatPanel
              askQuestion={askQuestion}
              chatError={chatError}
              chatInput={chatInput}
              isAsking={isAsking}
              messages={messages}
              setChatInput={setChatInput}
              submitQuestion={submitQuestion}
            />
          </div>
        </main>
      </div>
    </div>
  );
}

function InventoryTable({
  analyses,
  search,
  setSearch,
  visibleInventory,
}: {
  analyses: InventoryAnalysis[];
  search: string;
  setSearch: (value: string) => void;
  visibleInventory: InventoryAnalysis[];
}) {
  return (
    <section
      aria-labelledby="inventory-heading"
      className="min-w-0 overflow-hidden rounded-2xl border border-[#dde3df] bg-white shadow-[0_1px_2px_rgba(15,35,30,.04)]"
    >
      <div className="flex flex-col gap-4 border-b border-[#e5e9e6] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2
            className="text-base font-semibold tracking-[-0.02em]"
            id="inventory-heading"
          >
            Inventory details
          </h2>
          <p className="mt-0.5 text-xs text-[#7a8682]">
            {visibleInventory.length} of {analyses.length} products
          </p>
        </div>
        <div className="relative sm:w-64">
          <Icon
            className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[#87928e]"
            name="search"
          />
          <input
            aria-label="Search inventory"
            className="h-10 w-full rounded-xl border border-[#d9e0dc] bg-[#f8f9f7] pr-3 pl-9 text-sm outline-none transition placeholder:text-[#9aa49f] focus:border-[#78a99b] focus:ring-3 focus:ring-[#dff5ec]"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search SKU, product, supplier…"
            type="search"
            value={search}
          />
        </div>
      </div>
      <div className="scrollbar-subtle max-h-[680px] overflow-auto">
        <table className="w-full min-w-[900px] border-collapse text-left text-sm">
          <caption className="sr-only">
            Validated inventory with calculated coverage, reorder values, and
            risk
          </caption>
          <thead className="sticky top-0 z-10 bg-[#f8faf8] text-[10px] font-bold tracking-[0.12em] text-[#74807c] uppercase">
            <tr>
              <th className="px-5 py-3" scope="col">Product</th>
              <th className="px-4 py-3" scope="col">Supplier</th>
              <th className="px-4 py-3 text-right" scope="col">Stock</th>
              <th className="px-4 py-3 text-right" scope="col">Coverage</th>
              <th className="px-4 py-3 text-right" scope="col">Reorder point</th>
              <th className="px-4 py-3 text-right" scope="col">Shortfall</th>
              <th className="px-5 py-3" scope="col">Risk</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#edf0ee]">
            {visibleInventory.map((item) => (
              <tr className="transition hover:bg-[#f8faf8]" key={item.sku}>
                <td className="px-5 py-4">
                  <p className="font-medium text-[#1c2b27]">
                    {item.productName}
                  </p>
                  <p className="mt-1 font-mono text-[10px] font-semibold tracking-[0.06em] text-[#789087]">
                    {item.sku}
                  </p>
                </td>
                <td className="max-w-48 px-4 py-4 text-xs leading-5 text-[#66736e]">
                  {item.supplier}
                </td>
                <td className="px-4 py-4 text-right font-medium tabular-nums">
                  {formatNumber(item.currentStock)}
                </td>
                <td className="px-4 py-4 text-right tabular-nums text-[#44534e]">
                  {formatDays(item.daysOfStock)}
                </td>
                <td className="px-4 py-4 text-right tabular-nums text-[#44534e]">
                  {formatNumber(item.reorderPoint)}
                </td>
                <td
                  className={`px-4 py-4 text-right font-semibold tabular-nums ${item.reorderShortfall > 0 ? "text-orange-700" : "text-[#8a9691]"}`}
                >
                  {formatNumber(item.reorderShortfall)}
                </td>
                <td className="px-5 py-4">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold ring-1 ring-inset ${riskClasses(item.stockoutRisk.level)}`}
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-current" />
                    {riskLabel(item.stockoutRisk.level)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {visibleInventory.length === 0 && (
          <div className="grid min-h-44 place-items-center px-6 text-center text-sm text-[#73807b]">
            No products match “{search}”.
          </div>
        )}
      </div>
    </section>
  );
}

function ChatPanel({
  askQuestion,
  chatError,
  chatInput,
  isAsking,
  messages,
  setChatInput,
  submitQuestion,
}: {
  askQuestion: (question: string) => Promise<void>;
  chatError: string | null;
  chatInput: string;
  isAsking: boolean;
  messages: ChatMessage[];
  setChatInput: (value: string) => void;
  submitQuestion: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <section
      aria-labelledby="assistant-heading"
      className="flex min-h-[650px] min-w-0 flex-col overflow-hidden rounded-2xl border border-[#cfdbd5] bg-white shadow-[0_12px_30px_rgba(22,48,42,.07)]"
      id="assistant"
    >
      <div className="grid-texture flex items-center justify-between bg-[#102b2b] px-5 py-4 text-white">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#c7f36b] text-[#102b2b]">
            <Icon className="h-5 w-5" name="spark" />
          </span>
          <div>
            <h2 className="text-sm font-semibold" id="assistant-heading">
              Ask SupplyGuard
            </h2>
            <p className="mt-0.5 flex items-center gap-1.5 text-[10px] text-[#a9c3bb]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#c7f36b]" />
              Grounded in this inventory
            </p>
          </div>
        </div>
        <Icon className="h-5 w-5 text-[#70968a]" name="shield" />
      </div>

      <div
        aria-live="polite"
        className="scrollbar-subtle flex-1 space-y-4 overflow-y-auto bg-[#f8faf8] p-4"
      >
        {messages.length === 0 && (
          <div className="rounded-2xl border border-[#dce5e0] bg-white p-4">
            <p className="text-sm font-medium text-[#20302b]">
              What would you like to know?
            </p>
            <p className="mt-1 text-xs leading-5 text-[#71807a]">
              I use verified tool results from your active dataset. Try one of
              these:
            </p>
            <div className="mt-3 space-y-2">
              {SUGGESTED_QUESTIONS.map((question) => (
                <button
                  className="group flex w-full items-center justify-between gap-3 rounded-xl border border-[#e0e6e2] px-3 py-2.5 text-left text-xs font-medium text-[#40504a] transition hover:border-[#9ec3b6] hover:bg-[#f1faf6]"
                  disabled={isAsking}
                  key={question}
                  onClick={() => void askQuestion(question)}
                  type="button"
                >
                  {question}
                  <Icon
                    className="h-3.5 w-3.5 shrink-0 text-[#8a9993] transition group-hover:translate-x-0.5"
                    name="chevron"
                  />
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((message) =>
          message.role === "user" ? (
            <div className="ml-8 flex justify-end" key={message.id}>
              <p className="rounded-2xl rounded-br-md bg-[#102b2b] px-4 py-3 text-sm leading-6 text-white">
                {message.text}
              </p>
            </div>
          ) : (
            <article
              className="mr-3 rounded-2xl rounded-tl-md border border-[#dce5e0] bg-white p-4"
              key={message.id}
            >
              <div className="flex gap-2.5">
                <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[#dff5ec] text-[#0f766e]">
                  <Icon className="h-4 w-4" name="spark" />
                </span>
                <p className="whitespace-pre-wrap text-sm leading-6 text-[#263631]">
                  {message.text}
                </p>
              </div>
              {!message.responseComplete && (
                <div
                  className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800"
                  role="status"
                >
                  This answer may be incomplete
                  {message.finishReason === null
                    ? "."
                    : ` (${message.finishReason}).`} Review the verified evidence below.
                </div>
              )}
              <div className="mt-3 border-t border-[#edf1ee] pt-3">
                <p className="text-[10px] font-bold tracking-[0.1em] text-[#7b8983] uppercase">
                  {message.toolCallsUsed} tool call
                  {message.toolCallsUsed === 1 ? "" : "s"} ·{" "}
                  {message.evidence.length} evidence item
                  {message.evidence.length === 1 ? "" : "s"}
                </p>
                {message.evidence.map((evidence, index) => (
                  <details
                    className="mt-2 rounded-lg border border-[#e1e7e3] bg-[#f8faf8] text-xs"
                    key={`${message.id}-${evidence.tool}-${index}`}
                  >
                    <summary className="cursor-pointer px-3 py-2 font-mono font-semibold text-[#315a4f]">
                      {evidence.tool}
                    </summary>
                    <div className="border-t border-[#e1e7e3] px-3 py-2">
                      <p className="font-semibold text-[#68756f]">Arguments</p>
                      <pre className="scrollbar-subtle mt-1 overflow-x-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-4 text-[#42504b]">
                        {JSON.stringify(evidence.arguments, null, 2)}
                      </pre>
                      <p className="mt-2 font-semibold text-[#68756f]">Result</p>
                      <pre className="scrollbar-subtle mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-4 text-[#42504b]">
                        {JSON.stringify(evidence.result, null, 2)}
                      </pre>
                    </div>
                  </details>
                ))}
              </div>
            </article>
          ),
        )}

        {isAsking && (
          <div
            className="mr-16 flex items-center gap-3 rounded-2xl rounded-tl-md border border-[#dce5e0] bg-white px-4 py-3 text-xs text-[#6d7b75]"
            role="status"
          >
            <span className="flex gap-1">
              <i className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#0f766e]" />
              <i className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#0f766e] [animation-delay:120ms]" />
              <i className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#0f766e] [animation-delay:240ms]" />
            </span>
            Checking verified inventory data…
          </div>
        )}
        {chatError !== null && (
          <div
            className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs leading-5 text-red-700"
            role="alert"
          >
            {chatError}
          </div>
        )}
      </div>

      <form
        className="border-t border-[#e0e6e2] bg-white p-4"
        onSubmit={submitQuestion}
      >
        <label className="sr-only" htmlFor="inventory-question">
          Ask a question about this inventory
        </label>
        <div className="flex items-end gap-2 rounded-2xl border border-[#d3ddd8] bg-[#f8faf8] p-2 focus-within:border-[#71a594] focus-within:ring-3 focus-within:ring-[#dff5ec]">
          <textarea
            className="max-h-28 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-sm leading-5 outline-none placeholder:text-[#939e99]"
            disabled={isAsking}
            id="inventory-question"
            maxLength={2000}
            onChange={(event) => setChatInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                if (chatInput.trim().length > 0) {
                  void askQuestion(chatInput);
                }
              }
            }}
            placeholder="Ask about stock, risk, or reorder needs…"
            rows={1}
            value={chatInput}
          />
          <button
            aria-label="Send question"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#0f766e] text-white transition hover:bg-[#0b615b] disabled:cursor-not-allowed disabled:opacity-40"
            disabled={isAsking || chatInput.trim().length === 0}
            type="submit"
          >
            <Icon className="h-4 w-4" name="send" />
          </button>
        </div>
        <p className="mt-2 text-center text-[9px] leading-4 text-[#8b9691]">
          Answers are generated from tool evidence. Verify critical
          replenishment decisions.
        </p>
      </form>
    </section>
  );
}
