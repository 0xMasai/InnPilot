# Phase 4 — Read-Only Tools, Backed by Real Data

Fourteen read-only tools now answer questions from this hotel's actual
Firestore data, computed by the same code as the dashboards.

```
functions/src/ai/
  data/
    paths.ts          # Admin-SDK mirror of src/lib/hotelScope.ts
    hotelData.ts      # the only place tools read Firestore; per-turn cache
  tools/
    inputs.ts         # shared schemas + validators (period, day, no-input)
    index.ts          # registration
    read/
      financials.ts   # occupancy, revenue, expenses, restaurant, conference
      frontDesk.ts    # room status, check-ins, check-outs, in-house
      reservations.ts # reservation lookup, upcoming arrivals
      reports.ts      # daily / weekly / monthly
  toolRunner.ts       # the one path from "model asked" to "tool ran"
```

## The tools

| Tool | Returns |
|---|---|
| `get_occupancy` | rooms total/occupied/available, occupancy rate |
| `get_revenue` | accommodation + restaurant + conference, total, expenses, net operating result, pending payments |
| `get_expenses` | total and per-department breakdown |
| `get_restaurant_sales` | revenue, order count, per-category breakdown |
| `get_conference_revenue` | revenue and event count |
| `get_room_status` | live status of every room, counts per status |
| `get_check_ins` / `get_check_outs` | arrivals / departures for a day |
| `get_in_house_guests` | current in-house guests + unsettled balance |
| `get_reservations` | lookup by status / guest name / room |
| `get_upcoming_reservations` | arrivals in the next N days |
| `generate_daily/weekly/monthly_report` | structured report over the matching window |

Every period-based tool accepts `period` (today, yesterday, week, month,
lastMonth, all) or an explicit `startDate`/`endDate` pair.

## How "must agree with the dashboards" is actually enforced

Not by re-implementing the math and hoping it matches — by **compiling the
app's own modules into the functions bundle**. `functions/tsconfig.json` now
sets `rootDir: ".."` and includes `../src/lib/metrics.ts`, `../src/lib/pms.ts`
and `../src/lib/collections.ts`. Tools call `computeMetrics`, `getRange`,
`customRange`, `toPMSDate` and `isSameDay` directly. There is one definition
of "revenue", "this week" and "occupancy" in this repository, and both the UI
and the AI use it. (Build output therefore lands at `lib/functions/src/**`;
`package.json`'s `main` was updated to match.)

Two consequences worth stating plainly:

- **One frontend file changed.** `src/lib/metrics.ts` no longer imports
  `Timestamp` from `firebase/firestore`. The `v instanceof Timestamp` branch
  was redundant: the very next branch already duck-types anything with a
  `toDate()` method, which covers the client Timestamp identically *and* the
  Admin SDK's. Removing the import is behaviour-preserving for the app (app
  typecheck and all 48 rules tests pass) and is what makes the module usable
  server-side at all. This was the smallest change that avoids duplicating
  359 lines of business math.
- **Sources match the dashboards exactly.** `Overview.tsx` and `Reports.tsx`
  read BOTH `accomodation` and `reservations` and concatenate them before
  computing metrics (commit `1505431`). `hotelData.bookings()` does the same.
  This supersedes the Phase 1 plan, which predated that fix and proposed
  reading only the legacy collection — the dual-source risk flagged there is
  already resolved in the app, and the tools now inherit the resolution
  rather than reintroducing the split.

Front-desk tools mirror `FrontDesk.tsx`'s definitions exactly — arrivals are
`Confirmed` + check-in today, departures are `Checked In` + check-out today,
unsettled uses that page's own `pricePaid` field — so a manager comparing the
assistant with the Front Desk screen sees the same counts.

## Decisions made while implementing (flagging, not asking permission for)

- **The tool-call loop is implemented (Phase 6's mechanism, early).** Without
  it Phase 4 would have shipped 14 tools nothing could call, while the system
  prompt — which renders the live registry — advertised them to the model.
  That state is worse than no tools. `handleTurn` now runs
  provider → tools → provider until the model stops asking, capped at 4
  rounds. Phase 6 still owns *selection* quality (fewer, better-chosen calls)
  and any per-turn budget.
- **The model only ever sees tools it may call.** `toolsFor(ctx, ...)` filters
  the registry through the Permission Guard, and that same filtered list feeds
  both the system prompt and the schemas sent to the provider — so prompt,
  advertised tools, and what the Guard will permit cannot disagree. A
  `super_admin` (no hotel) and a `pending` account are advertised zero tools.
- **One data loader per turn.** Several tools in one turn share one Firestore
  read per collection (measured: 5 tools, 38 ms total, first tool pays the
  reads), and a loader cannot outlive its turn, so no request can serve
  another request's data.
- **Write tools are refused in the runner**, not merely absent — defence in
  depth for Phase 10, so a write can never execute on the model's say-so even
  once write tools exist.
- **No housekeeping / maintenance / night-audit tools**, per the Phase 1
  decision: those collections are declared in `collections.ts` but have no
  page, model, or data anywhere in the app. A tool over them would have to
  invent a data model, which is what "never fabricate data" forbids.
- **Results always carry their provenance.** Every result states its period,
  its `source` where two collections could be meant, and `truncated: true`
  when a list was cut off — so the model cannot summarise a partial list as if
  it were complete.
- **A bug found and fixed during validation:** the first date validator
  pattern-matched `YYYY-MM-DD` but let `2026-13-45` through, because
  `new Date(2026, 12, 45)` silently rolls over to 2027-02-14 rather than
  producing an invalid date. It now round-trips the parsed components and
  rejects. The same validator was duplicated in three files; it is now shared
  in `inputs.ts`.

## Validation

Run against the **Firestore emulator** seeded with a realistic two-hotel
dataset (10 rooms across 4 statuses, legacy + reservation bookings, a
cancelled booking, a cancelled order, restaurant/conference/expense records
across today and yesterday, plus a second hotel whose data must never
appear).

- **All 14 tools return correct figures**, hand-checked against the seed —
  e.g. today's accommodation revenue 750,000 correctly includes the two legacy
  bookings and one reservation and excludes the cancelled one; restaurant
  65,000 excludes the cancelled order; occupancy 4/10 = 40%; yesterday's
  figures shift correctly.
- **Tenant isolation:** the other hotel's records never appear in any result;
  a `hotelId` argument added to a tool call is rejected as an unknown
  parameter (the hotel comes only from the server-derived context).
- **Role gating:** `hotel_admin`/`staff` are advertised 14 tools;
  `pending` and `super_admin` are advertised 0 and denied on direct call.
- **Malformed and hostile input:** 14 cases all rejected with specific
  messages — unknown periods, SQL-ish strings, half-specified ranges,
  inverted ranges, impossible calendar dates, non-object input, out-of-range
  and non-integer limits, over-long strings, unknown status values, and an
  unknown tool name.
- **End-to-end through the orchestrator** (mock provider, real tools, real
  Firestore): "What's our revenue today and how full are we?" → two parallel
  tool calls in one round → results batched into one turn → final answer
  "Today's total revenue is UGX 1,315,000 and occupancy is 40%", with tool
  activity persisted to conversation history.
- **Safety paths:** a model that never stops requesting tools is capped at 4
  rounds and told so; a tool the model invents comes back as
  `isError: true, "No such tool: ..."` rather than being silently dropped.
- **Empty data** reports as a finding: with no rooms registered, occupancy
  rate is `null` and the report says "No rooms are registered, so occupancy
  rate is undefined" — not 0%.
- `functions`: `tsc --noEmit` clean, `npm run build` clean.
- Root app: `tsc -b` clean; all **48 Firestore rules tests pass**;
  `npm run lint` goes from 55 problems to 47 (this phase adds none and
  cleans up Phase 2's `any` usages via the new `AnyToolDefinition`).
- Not done (deliberately): committed unit tests — that is Phase 15. The above
  was exercised through throwaway scripts against the emulator, not a suite.

## Risks / outstanding issues

- **Whole-collection reads.** Each tool reads entire collections and filters
  in memory, because that is exactly what `metrics.ts` semantics require
  (date fields have fallbacks that Firestore cannot index over) and what the
  dashboards already do. Fine at current data sizes; it will need date-bounded
  queries, or a rollup, before a hotel accumulates years of records.
- **`FrontDesk.tsx` reads `pricePaid` on reservations, but the `Reservation`
  type defines `totalAmount`.** The unsettled-balance figure inherits that,
  so it can read as 0 for reservations that only carry `totalAmount`. The
  tools mirror the screen deliberately (agreeing with the UI is the rule), but
  this looks like a real app-level bug worth fixing on the frontend — after
  which the tool follows automatically.
- Reservation tools read `reservations` only, while revenue/occupancy read
  the combined set. Each result states its `source`, but a hotel still on the
  legacy flow will see fewer reservations than its revenue implies.
- Tools are advertised on every turn (~14 schemas). Prompt caching becomes
  worthwhile once the tool list stabilises.
