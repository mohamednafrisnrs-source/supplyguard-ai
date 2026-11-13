# SupplyGuard AI

SupplyGuard AI is an open-source supply-chain inventory Q&A agent. The project is intended to help operations teams ask plain-language questions about stock levels, demand, supplier lead times, and replenishment risk.

This repository contains the Phase 4 inventory control dashboard, deterministic calculation engine, and grounded Gemini inventory Q&A agent. Teams can validate a local CSV, review calculated replenishment risk, search the inventory, and ask questions backed by tool evidence.

## Technology

- Next.js App Router
- TypeScript
- Tailwind CSS
- Google Gen AI SDK (`@google/genai`)
- Papa Parse
- Vitest

## Setup

Requirements:

- Node.js 20.9 or newer
- npm

Install dependencies:

```bash
npm install
```

Copy the environment template and add a Gemini API key for local server-side use:

```bash
cp .env.example .env.local
```

```dotenv
GEMINI_API_KEY=your_api_key
GEMINI_MODEL=gemini-3.5-flash-lite
```

`GEMINI_MODEL` is optional and defaults to `gemini-3.5-flash-lite`, which completed the synthetic inventory function-calling smoke test. Set `GEMINI_MODEL` to use another compatible model without changing code. Do not prefix the API key with `NEXT_PUBLIC_`. Browser-exposed environment variables are bundled into client code, while the Gemini key must remain server-side. Local `.env*` files are ignored by Git; `.env.example` is the only tracked exception.

Start the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Quality checks

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Vitest covers CSV validation, calculation formulas, risk boundaries, tool execution, mocked Gemini round trips, injection attempts, tool limits, API validation, and browser-like UI integration with mocked API responses.

## Dashboard

The home page is a responsive inventory operations dashboard. It initially loads the synthetic repository fixture and supports replacing it with a local CSV through **Upload CSV**. **Load sample** restores the repository fixture.

The interface includes:

- KPI cards calculated from the active data: total products, critical products, and products at or below their reorder point.
- A searchable inventory table with SKU, product, supplier, stock, days of coverage, reorder point, shortfall, and Phase 2 risk status.
- Suggested inventory questions and a free-text Q&A input connected to `POST /api/ask`.
- Loading and error states, tool-call counts, and expandable evidence containing the actual tool arguments and results.
- Responsive layouts, keyboard-accessible controls, semantic table markup, live status messages, and reduced-motion support.

CSV files are parsed and validated in the browser using the same Phase 2 parser before their data is displayed. The original validated CSV text is sent to `/api/ask`, where it is independently validated again. Uploads remain in browser memory and are not persisted. Changing the inventory aborts an in-flight question and clears earlier answers and evidence so they cannot be mistaken for results from the new dataset.

## Sample dataset

The synthetic dataset is stored at [`src/data/inventory.csv`](src/data/inventory.csv). It contains fictional inventory records and no production, customer, or supplier data.

| Column | Meaning |
| --- | --- |
| `sku` | Stable product identifier |
| `product_name` | Fictional product description |
| `current_stock` | Units currently on hand |
| `average_daily_demand` | Mean units consumed per day |
| `lead_time_days` | Supplier replenishment lead time in days |
| `safety_stock` | Minimum buffer stock in units |
| `supplier` | Fictional supplier name |

The parser loads this fixture into typed inventory records. The data remains synthetic and is not connected to Gemini or an external system.

## Inventory calculation engine

The inventory module is exported from `src/lib/inventory/index.ts`. It provides:

- `parseInventoryCsv()`
- `calculateDaysOfStock()`
- `calculateReorderPoint()`
- `calculateStockoutRisk()`
- `analyzeInventory()`

### Formulas

The engine uses the supplied values without rounding:

```text
days of stock = current stock / average daily demand
reorder point = average daily demand × lead time days + safety stock
reorder shortfall = max(0, reorder point − current stock)
```

For example, stock of 100 units, daily demand of 20 units, a 7-day lead time, and 20 units of safety stock produce:

- Days of stock: `5`
- Reorder point: `160`
- Reorder shortfall: `60`

### Stockout risk levels

Risk levels are evaluated in this order:

| Level | Definition |
| --- | --- |
| `critical` | Demand is positive and stock is zero, or days of stock are less than or equal to supplier lead time. |
| `high` | Stock is below the reorder point but is not already critical. |
| `medium` | Stock equals the reorder point, so replenishment is due. |
| `low` | Stock is above the reorder point, but days of stock are no more than twice the lead time. |
| `none` | Coverage is outside the above risk conditions, or average daily demand is zero. |

Every assessment includes human-readable reasons and the actual inputs and calculated values used to assign the level.

### CSV validation and limits

The parser treats all input as untrusted text and fails the entire import when validation finds an issue. It:

- Requires each documented header exactly once, while allowing column reordering.
- Keeps Papa Parse dynamic typing disabled and converts numeric fields explicitly.
- Requires every field and rejects negative, non-decimal, non-finite, underflowed, or excessively large numbers.
- Detects duplicate SKUs case-insensitively.
- Rejects malformed rows, malformed CSV quoting, forbidden control characters, and overlong text fields.
- Limits input to 1 MiB and 10,000 data rows by default. Callers can lower these limits.
- Treats formula-like cell text as inert strings. Any future spreadsheet export must still apply output-specific CSV injection protection.

### Assumptions

- Inventory quantities, daily demand, lead time, and safety stock are non-negative.
- Fractional values are supported because demand and some inventory units may be measured continuously.
- Zero demand returns `null` for days of stock instead of `Infinity`. It produces no demand-driven stockout risk, although the reorder-point and shortfall values still show the safety-stock target.
- Zero lead time reduces the reorder point to safety stock.
- Calculations return full JavaScript numeric precision. Presentation layers can round for display later.

### Running tests

Run the full Vitest suite once:

```bash
npm test
```

Run tests in watch mode during development:

```bash
npm run test:watch
```

## Gemini inventory agent

The agent uses manual Gemini function calling. SDK automatic function execution is disabled so the application can validate every requested tool and argument before running local code.

### Tools

`search_inventory` accepts:

```json
{ "query": "SKU or product text", "limit": 10 }
```

It searches SKU, product name, and supplier fields. A query of `"*"` lists records. Results are limited to 20 items per call.

`analyze_inventory` accepts:

```json
{ "skus": ["SG-1001", "SG-1002"] }
```

It analyzes up to 20 exact SKUs using the Phase 2 `analyzeInventory()` function. The agent does not contain separate inventory formulas.

The tool loop validates names and arguments, returns each real tool response to Gemini, and permits at most five requested tool calls. After the limit, tools are disabled and Gemini receives one final opportunity to summarize the retrieved evidence.

Questions that produce no successful inventory evidence receive a fixed unsupported-response message instead of an ungrounded model answer.

Final responses are limited to 1,024 output tokens and instructed to use compact per-SKU summaries. SDK automatic continuation is disabled. The API reports the provider finish reason and whether generation completed normally; a `MAX_TOKENS` response is marked incomplete and retains its verified evidence instead of silently presenting partial prose as complete.

## API

`POST /api/ask` accepts `application/json`:

```json
{
  "question": "Which gloves need reordering?",
  "inventoryCsv": "sku,product_name,current_stock,average_daily_demand,lead_time_days,safety_stock,supplier\n..."
}
```

Successful response:

```json
{
  "answer": "Grounded answer from Gemini",
  "evidence": [
    {
      "tool": "analyze_inventory",
      "arguments": { "skus": ["SG-1001"] },
      "result": { "analyses": [] }
    }
  ],
  "toolCallsUsed": 1,
  "responseComplete": true,
  "finishReason": "STOP"
}
```

`responseComplete` is `false` when Gemini stops for a non-normal finish reason such as `MAX_TOKENS`. Clients should display the evidence and warn that the prose answer may be incomplete.

The route limits the complete request body to 1.25 MiB, the question to 2,000 characters, and the CSV to the parser's 1 MiB and 10,000-row limits. It returns structured errors with these principal statuses:

| Status | Meaning |
| --- | --- |
| `400` | Invalid JSON, request shape, or question |
| `413` | Request body exceeds the API limit |
| `415` | Content type is not `application/json` |
| `422` | Inventory CSV validation failed |
| `502` | Gemini provider request failed |
| `503` | `GEMINI_API_KEY` is not configured |

### Security controls

- The Gemini key is read only on the server and is never included in prompts, tool output, evidence, or errors.
- Request JSON, questions, CSV fields, Gemini tool names, and Gemini arguments are treated as untrusted.
- Only the two declared inventory tools can run. Unknown tools and extra arguments return controlled errors.
- Tools perform in-memory search and analysis only. They cannot execute commands, access the filesystem, or read environment variables.
- Inventory strings are labelled as untrusted data in the system instruction so embedded prompt text is not authoritative.
- Provider errors are replaced with generic API responses, and all endpoint responses use `Cache-Control: no-store`.
- Provider diagnostics contain only safe metadata: call stage, duration, tool count, error class, HTTP status, provider code, and provider status. Prompts, CSV content, outputs, headers, and credentials are excluded.
- Gemini attempts have a 20-second timeout, two-attempt maximum for explicitly transient statuses, and a 60-second overall agent deadline.

## Application architecture

The implementation keeps data handling, model orchestration, and presentation separate:

1. `src/lib/inventory/` loads and validates inventory records, then exposes deterministic inventory calculations.
2. `src/lib/agent/` defines server-only Gemini orchestration and validated tool contracts that call the inventory layer.
3. `app/api/ask/route.ts` receives questions and CSV data without exposing `GEMINI_API_KEY` to the browser.
4. `src/components/inventory-dashboard.tsx` validates uploads, renders calculated inventory state, and sends the active validated CSV to the API without receiving the Gemini key.
5. `app/page.tsx` remains a Server Component and provides the synthetic sample CSV to the interactive dashboard as a serializable prop.
6. `tests/` cover inventory calculations, tool behavior, agent boundaries, API validation, and UI/API integration with deterministic fixtures and mocked Gemini responses.

The MVP will use the repository dataset directly. It will not include a database or authentication.

## Repository boundary

SupplyGuard AI is maintained as its own Git repository. It has no configured remote and is not part of the Chainkit repository. Do not copy secrets, Git metadata, or implementation code between the repositories.

## UI integration tests

The UI tests run in jsdom with React Testing Library and mock `fetch`; they never call Gemini. They verify data-derived KPI and table values, search filtering, the exact CSV sent to `/api/ask`, grounded answer/evidence rendering, API errors, safe text rendering, invalid uploads, and clearing answers after a dataset change.

```bash
npm test
```

## Optional real Gemini smoke test

With `GEMINI_API_KEY` configured in `.env.local`, start the app and use the bundled synthetic sample:

```bash
npm run dev
```

Ask **Which products are critical?** and verify that the response contains an answer, non-empty inventory evidence, a positive `toolCallsUsed` value, `responseComplete: true`, and `finishReason: "STOP"`. Never use production inventory for this smoke test.

## Current scope

Phase 5 includes the scaffold, synthetic sample data, CSV parser, calculation engine, risk model, Gemini function-calling agent, completion detection, bounded provider requests, server API, responsive inventory dashboard, CSV upload, and automated integration tests. The MVP intentionally does not include:

- Database storage or file persistence
- Authentication or multi-user accounts
- Client-side API keys

## License

SupplyGuard AI source code and project-authored assets are available under the [MIT License](LICENSE). Third-party dependencies and trademarks remain subject to their respective licenses and policies.
