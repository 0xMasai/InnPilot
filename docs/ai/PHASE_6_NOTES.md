# Phase 6 — Agent Orchestration

"Select and call only the minimum relevant tools per request." Part of that
is the model's judgement, which is steered rather than enforced; the rest
is the system's job, and that part is now enforced in code and measured.

## What changed

### 1. Tool descriptions that settle overlaps

The tools overlap on purpose — `generate_report` contains what four other
tools return, `get_revenue` already includes restaurant, conference and
expense totals — and overlap is where a model picks wrong. Every
description now carries an explicit **USE FOR** and, where two tools
compete, a **NOT FOR** naming the tool that wins:

- `generate_report` — "PREFER THIS over calling get_occupancy, get_revenue,
  get_expenses and get_check_ins separately."
- `get_revenue` — "THIS ALONE IS ENOUGH ... do not also call
  get_restaurant_sales, get_conference_revenue or get_expenses unless the
  user asks how a total breaks down."
- `get_occupancy` vs `get_room_status` — counts versus the room-by-room
  list, each pointing at the other.
- `get_check_ins`/`get_check_outs` vs `get_reservations` — one day versus
  across days.

The system prompt states the same rules once more, in the order a model
reads them.

### 2. Repeated calls are not repeated work

Identical calls within a turn are served from the first result. The key is
built from the **validated** input, so `{}` and `{"period":"today"}` are
recognised as the same request rather than paid for twice. Failed calls are
never cached as their own answer — a retry can genuinely retry.

Both calls stay in `toolCalls`, the second marked `reusedEarlierResult`.
The record shows what the model actually asked for, which is what Phase 12's
audit trail and Phase 8's UI should display — not a tidied-up version.

### 3. One turn, one read

A request-scoped cache (`server/ai/requestCache.ts`, AsyncLocalStorage)
means tools sharing a collection share the query. `get_occupancy` and
`get_check_ins` both read bookings; that is now one read, not two. Promises
are cached rather than values, so tools running concurrently share a single
in-flight query instead of racing.

**Measured against the live project: three tools that share reads went
1026ms to 225ms.** Same answers, roughly a fifth of the latency.

There is a second benefit worth stating: every figure in one reply now
comes from one snapshot, so occupancy and arrivals in the same answer
cannot disagree because a booking changed between two reads.

Tools were not modified for any of this — `dataAccess` consults the ambient
cache when there is one, and behaves exactly as before when there is not
(a script, a test).

### 4. A ceiling on what one question can cost

`MAX_TOOL_CALLS_PER_TURN = 8`, alongside the existing 3-round cap. Calls
past the ceiling come back as an error telling the model to answer from what
it has and say what it could not check — the honest failure, not a silent
truncation. Refusals are still recorded, so the turn's real cost stays
visible.

## What was deliberately not built

**Pre-filtering the tool list by keyword.** The obvious reading of "select
the minimum relevant tools" is to send the model only the tools that look
relevant to the question. It was rejected: ten small schemas cost little,
and a keyword gate that guesses wrong makes a legitimate question
unanswerable — the failure is silent and looks like the assistant being
useless. Steering the choice beats removing the option. If the tool list
grows past what fits comfortably in a request, the provider-side tool-search
mechanisms are the better answer.

## Validation

- **137 tests pass** (11 files); 12 added this phase in
  `tests/ai/toolSelection.test.ts`.
- The new suite covers what is actually enforceable: duplicate suppression,
  defaulted-vs-explicit arguments treated as one call, different arguments
  *not* conflated, failures not cached, one read shared across tools, a
  fresh read next turn, the call ceiling, and every description carrying
  its USE FOR guidance.
- Cache benefit measured against live Firestore, not assumed (above).
- `npx tsc -b` and `npx eslint server api` clean.

## Risks / outstanding issues

- **Tool selection itself is still unverified end to end.** Whether the
  model actually calls `generate_report` once instead of four tools needs a
  live provider; this sandbox blocks egress to the API. Phase 16's
  evaluation set is where that gets measured, and the descriptions above
  are the lever to tune when it is.
- **A turn's data is a snapshot.** Correct for a single answer, but a long
  turn will not see a booking made while it runs. The right trade for
  consistency, worth knowing.
- No rate limiting or spend cap still stands. The per-turn ceiling bounds
  one question; nothing yet bounds how many questions one account can ask.

---

PHASE COMPLETE: Phase 6 — Agent Orchestration
Implemented:
- USE FOR / NOT FOR guidance on all ten tool descriptions, resolving every
  overlap in favour of the single-call tool
- Tool-selection rules in the system prompt, matching those descriptions
- Duplicate-call suppression keyed on validated input, with reuse recorded
  rather than hidden
- Request-scoped read cache (AsyncLocalStorage) shared by all tools in a
  turn; 1026ms to 225ms on three tools against live data
- A per-turn ceiling of 8 tool calls, refusing further calls honestly
Files created:
- server/ai/requestCache.ts
- tests/ai/toolSelection.test.ts
- docs/ai/PHASE_6_NOTES.md (this document)
Files modified:
- server/ai/orchestrator.ts (reuse, budget, cache scope, prompt rules)
- server/ai/tools/dataAccess.ts (reads through the cache)
- server/ai/types.ts (ToolCallRecord.reusedEarlierResult)
- server/ai/tools/read/*.ts (descriptions)
Dependencies added:
- none (AsyncLocalStorage is a Node built-in)
Database changes:
- none
Tests:
- 12 added; 137 pass in total
Validation:
- lint: clean (server + api)
- typecheck: clean (`npx tsc -b`)
- build: clean (`npm run build`)
Risks / outstanding issues:
- Model tool-choice unverified end to end until a live provider call
- A turn reads one snapshot; concurrent changes are not seen mid-turn
- Still no per-account rate limit or spend cap
NEXT PHASE:
Phase 7 — the centralized InnPilot AI system prompt
STATUS:
WAITING FOR APPROVAL
