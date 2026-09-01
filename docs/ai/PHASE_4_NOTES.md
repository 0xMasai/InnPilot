# Phase 4 — Read-Only Tools

The agent can now answer from this hotel's real data. Ten read-only tools,
every figure computed by the same functions the dashboards use, and no path
by which a question becomes an invented number.

## The tools

| Tool | Answers | Reads |
|---|---|---|
| `get_occupancy` | "What's our occupancy?" | rooms + bookings |
| `get_room_status` | "Which rooms need cleaning?" | rooms + bookings |
| `get_check_ins` | "Who's arriving today?" | both booking sources |
| `get_check_outs` | "Who's leaving today?" | both booking sources |
| `get_reservations` | "What's in the book?" | reservations |
| `get_revenue` | "How much did we make?" | everything, via `computeMetrics` |
| `get_expenses` | "What did we spend?" | expenses |
| `get_restaurant_sales` | "How did the restaurant do?" | restaurant |
| `get_conference_revenue` | "How did events do?" | conferenceRooms |
| `generate_report` | "Generate today's report." | everything |

Two departures from the Phase 1 tool list, both to stop the model choosing
between near-identical options:

- **One `get_reservations` with a `window` argument** instead of separate
  `get_reservations` and `get_upcoming_reservations`.
- **One `generate_report` with a `period` argument** instead of daily,
  weekly and monthly tools. Their bodies and outputs would have been
  identical but for a constant, and three near-identical descriptions is
  precisely what makes a model pick wrong.

Housekeeping and maintenance tools stay dropped, per Phase 1: those
collections are declared in `collections.ts` but have no implementation,
model, or data anywhere in `src/`. Building tools for them would mean
inventing a data model the app does not have.

## The dual booking collections — answered by the code

Phase 1 flagged that `accomodation` and `reservations` are both live and
could disagree, and left the decision open. Reading the app settles it:
`Overview.tsx` and `Reports.tsx` already read **both** and combine them
before calling `computeMetrics` (there is even a comment there explaining
why). So `fetchBookings` does the same, and the assistant matches the
dashboards by construction rather than by a new judgement call.

One consequence worth knowing, because it will look like a bug otherwise:
`Reservations.tsx` writes `pricePaid: 0`, so a front-desk reservation
counts towards *bookings* but contributes nothing to *accommodation
revenue* until a payment is recorded. That is the app's existing revenue
definition, not something introduced here — `get_revenue` returns it in a
`definitions` field so the model explains the gap instead of misreporting
it. Changing the definition is a business decision, not this phase's.

## How a tool call is guarded

Four checks, in order, before any handler runs:

1. **Registry** — the model can only name tools that exist.
2. **Permission Guard** — `allowedRoles` mirrors `firestore.rules`
   exactly. `hotelStaff(hotelId)` there grants read on rooms,
   accomodation, reservations, restaurant, conferenceRooms and expenses to
   `hotel_admin` and `staff`, so every read tool allows that pair and
   nothing else. `super_admin` has no hotel and is refused by
   `requireHotelContext`; `pending` is refused outright. The two
   admin-only collections in the rules (`auditLog`, `nightAudits`) have no
   tools at all.
3. **`validateInput`** — hand-written per tool. The JSON Schema shown to
   the model is documentation, never the boundary: every value is re-checked
   server-side, unknown values rejected rather than coerced.
4. **`hotelId` from ToolContext only** — no tool accepts a hotel, property,
   or user id as an argument, so there is no parameter through which the
   model could reach another tenant.

A failure at any step becomes a tool *result* the model must account for
("the expenses lookup failed"), never a silent gap it can fill.

## Amendments to earlier phases

- **`ToolDefinition` gained `inputSchema`** (Phase 2). Without it there is
  no way to tell the model what a tool accepts. Documented in the type as
  documentation-not-security.
- **`ProviderMessage` became `ProviderTurn`** (Phase 3), a union of user,
  assistant, and tool_result turns. A tool round-trip requires replaying
  the model's own tool call before its result is accepted, which a flat
  `{role, content}` message cannot express. Assistant turns carry the
  opaque `raw` that Phase 3 already provided for exactly this.
- **The orchestrator now runs a bounded tool loop** — up to three rounds of
  model -> tools -> model, executing each round's calls together. This is
  the minimum that makes tools reachable at all; Phase 6 is where tool
  *selection* gets tuned, and the cap is what stops a confused model
  looping until the platform kills the request.
- **`src/lib/metrics.ts` no longer imports the client Firebase SDK.** It
  used `v instanceof Timestamp` in `toDateSafe`, which would have dragged
  the browser SDK into the serverless bundle. The existing duck-typed
  `toDate()` branch already covers both SDKs' Timestamp classes, so the
  import was removable with no behaviour change — verified against client
  Timestamps, admin Timestamps, Dates, ISO strings, and garbage.

## Validation

- `npx tsc -b` clean; `npx eslint server api` clean.
- **Existing tests: 53/53 pass** (rules + `tests/pms.test.ts`) against the
  Firestore emulator, including after the `metrics.ts` change.
- **Every tool executed against the live project** (`hotel-management-c183c`,
  hotel `M1kQfxBm1QvjDvzmluKu`) with a real ToolContext. All ten returned
  real data — 1 room available, 1 restaurant order at UGX 13,000, 3
  conference events at UGX 310,000 across 20 attendees, no bookings or
  expenses recorded yet.
- **Cross-tool agreement checked**: `get_revenue`'s restaurant and
  conference figures match `get_restaurant_sales` and
  `get_conference_revenue` exactly, and `totalRevenue` equals the sum of
  its parts.
- **Permission guard checked**: `hotel_admin` and `staff` allowed;
  `pending` denied; `super_admin` denied (no hotel context).
- **Input validation checked**: unknown period, half-specified custom
  range, malformed date, and reversed date range are each rejected with a
  message the model can act on.
- The model's own tool *selection* is not yet verified end to end — that
  needs a live provider call, which this sandbox's blocked egress prevents.
  `npm run smoke` plus a deployed request is how that gets confirmed.

## Risks / outstanding issues

- **Tools read whole collections.** `fetchBookings` and friends fetch every
  document, then filter in memory. That mirrors what the dashboards already
  do with `onSnapshot`, and is fine at this hotel's current size, but it is
  a per-request cost on the server: a hotel with tens of thousands of
  bookings would make every question slow and expensive. Date-bounded
  Firestore queries are the fix when it matters.
- **Guest names are returned** by the front-desk and room tools — the same
  data the Front Desk and Room Board show the same users. Nothing is logged
  yet (audit logging is Phase 12), where redaction will matter.
- No rate limiting or spend cap still stands from Phase 3.
- Occupancy comes from room *status*, while in-house guests come from
  booking *status*; the two are recorded separately and can disagree.
  `get_occupancy` returns a note when they do, rather than silently
  presenting one as the other.

---

PHASE COMPLETE: Phase 4 — Read-Only Tools
Implemented:
- Ten read-only tools over real Firestore data, all figures from
  `computeMetrics`/`pms.ts` so answers agree with the dashboards
- Admin-SDK data access mirroring `src/lib/hotelScope.ts` paths, reading
  both booking collections the way Overview and Reports already do
- Per-tool role sets mirroring `firestore.rules`, hand-written input
  validation, and hotelId taken only from the server-derived ToolContext
- A bounded tool-execution loop in the orchestrator, with tool failures
  surfaced to the model as errors rather than silent gaps
- System prompt updated to forbid any figure that did not come from a tool
Files created:
- server/ai/tools/dataAccess.ts, validation.ts, roles.ts, index.ts
- server/ai/tools/read/rooms.ts, finance.ts, frontDesk.ts, report.ts
- docs/ai/PHASE_4_NOTES.md (this document)
Files modified:
- server/ai/orchestrator.ts (tool loop, system prompt)
- server/ai/types.ts (ToolDefinition.inputSchema)
- server/ai/provider.ts, server/ai/providers/openai.ts (ProviderTurn)
- src/lib/metrics.ts (dropped the client-SDK import; no behaviour change)
Dependencies added:
- none
Database changes:
- none; every tool is read-only
Tests:
- none added (the server-side Vitest suite is Phase 15). Existing 53 tests
  pass; tools, guard, validation and cross-tool agreement verified against
  live data as recorded above
Validation:
- lint: clean (server + api)
- typecheck: clean (`npx tsc -b`)
- build: clean (`npm run build`)
Risks / outstanding issues:
- Whole-collection reads per request; fine now, wrong shape at scale
- Model tool-selection unverified end to end (needs a live provider call)
- No rate limiting or spend cap
- Reservations contribute bookings but not revenue until pricePaid is set
NEXT PHASE:
Phase 5 — Security / Permission Guard, with the cross-property, privilege
escalation, malicious parameter and prompt injection tests the brief lists
STATUS:
WAITING FOR APPROVAL
