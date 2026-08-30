# Phase 1 — Implementation Plan

Based only on repository inspection (Phase 0 findings plus the follow‑up
checks below). No code, dependencies, database, or environment files have
been changed in this phase.

## Follow‑up inspection since Phase 0

Phase 0 left two open items; both are now resolved by reading the actual
routes and call sites rather than assumed:

- **`accomodation` (`COLLECTIONS.BOOKINGS`) vs `reservations`
  (`COLLECTIONS.RESERVATIONS`) are both live, in parallel, today.**
  `App.tsx` wires up both: `/dashboard/reservations`, `/front-desk`,
  `/room-board` (newer PMS flow) read/write `RESERVATIONS`; `/dashboard`
  (Overview), `/accommodation`, `/guests`, `/reports`, and
  `/records/bookings` still read/write the legacy `BOOKINGS`
  (`"accomodation"`) collection. `Reservations.tsx` even keeps a
  `legacyPath` constant pointing at `BOOKINGS` for migration purposes. This
  is a real, current dual‑source situation in the app — not something to
  paper over. **Decision for V1:** `get_occupancy`, `get_revenue`, and the
  daily report/briefing tools should read from `COLLECTIONS.BOOKINGS` via
  `src/lib/metrics.ts`, because that is what the Overview dashboard and
  `Reports.tsx` show the manager today, and what "how is the hotel doing"
  should agree with. `get_reservations`/`get_upcoming_reservations` (Phase 4)
  should read `COLLECTIONS.RESERVATIONS`, since that's the live front‑desk
  flow. This inconsistency should be called out to you before Phase 4 ships,
  since the two collections can disagree.
- **Housekeeping, maintenance, and night‑audit have no implementation.**
  `COLLECTIONS.HOUSEKEEPING_TASKS`, `MAINTENANCE`, and `NIGHT_AUDITS` are
  declared in `collections.ts` but have zero read/write call sites anywhere
  in `src/`. There is no housekeeping or maintenance page, model, or data.
  **Decision for V1:** drop `get_maintenance_tasks`/`get_pending_tasks` and
  `create_maintenance_task` from the V1 tool set (Phase 4/10) — implementing
  them would mean inventing a data model the rest of the app doesn't have,
  which the brief explicitly says not to do ("never fabricate data",
  "do not rewrite InnPilot"). Recommend treating housekeeping/maintenance
  tools as a fast‑follow once (if) those pages exist.
- **Env var convention is Vite's `VITE_*` prefix**, read via
  `import.meta.env` (`firebase.ts`). Anything with that prefix is bundled
  into the public client JS. This directly determines the AI provider
  strategy below: `AI_API_KEY` must never use the `VITE_` prefix or live in
  the Vite env at all.

## Files to modify

| File | Change | Why |
|---|---|---|
| `src/dashboard.tsx` | add one `NavItem` + route entry for "Ask InnPilot" | reuses existing role‑aware sidebar/`<Outlet/>` pattern (Phase 8) |
| `src/App.tsx` | add one `<Route path="ask-innpilot" .../>` under the existing `/dashboard` route | consistent with every other module |
| `.env.example` | add (create if absent) `AI_PROVIDER=`, `AI_MODEL=` placeholders | Phase 3; no `VITE_` prefix, so these describe server‑side Cloud Functions config, not client env |
| `README.md` | short "AI Agent" section pointing at `docs/ai/` | Phase 17, kept minimal now |

No existing page, `lib/` module, Firestore rule, or business‑logic function
needs to change for V1's read path — `metrics.ts`, `pms.ts`, and `audit.ts`
are reused as‑is (see below), which satisfies "do not rewrite InnPilot."

## Files to create

**Cloud Functions (new package, since none exists — see Database/Backend
strategy below):**

```
functions/
  package.json                     # firebase-functions, firebase-admin, LLM SDK
  src/
    index.ts                       # exports the callable "aiChat" function
    ai/
      gateway.ts                   # request validation, auth context, entry point
      provider.ts                  # AIProvider interface + one implementation
      systemPrompt.ts              # Phase 7 prompt, adapted to real roles
      orchestrator.ts              # tool selection + multi‑tool calls
      toolRegistry.ts              # name → {schema, handler} map
      permissionGuard.ts           # mirrors firestore.rules role()/hotel() logic
      confirmationManager.ts       # pending‑write persistence + verification
      conversationManager.ts       # message history per hotel/user
      auditLogger.ts               # writes into existing hotels/{hotelId}/auditLog
      tools/
        read/
          getOccupancy.ts
          getRevenue.ts
          getExpenses.ts
          getRestaurantSales.ts
          getConferenceRevenue.ts
          getReservations.ts
          getUpcomingReservations.ts
          getRoomStatus.ts
          getCheckIns.ts
          getCheckOuts.ts
          generateDailyReport.ts
          generateWeeklyReport.ts
          generateMonthlyReport.ts
        write/
          updateRoomStatus.ts
          createNote.ts
```

**Frontend (Phase 8):**

```
src/pages/pms/AskInnPilot.tsx       # chat UI, follows existing page conventions
src/lib/aiClient.ts                 # thin wrapper around httpsCallable("aiChat")
```

**Docs (Phase 17, drafted incrementally — not all in Phase 1):**
`docs/ai/ARCHITECTURE.md`, `TOOLS.md`, `SECURITY.md`, `EVALUATION.md`
(brief and Phase 0 assessment already exist from prior phases).

## Existing APIs/services to reuse (do not reimplement)

- `src/lib/metrics.ts` — every revenue/expense/occupancy number a tool
  returns must come from these functions, so AI answers agree with the
  dashboards.
- `src/lib/pms.ts` — booking‑overlap, date, and status helpers for any tool
  touching bookings or rooms.
- `src/lib/collections.ts` — collection name constants; tools must use
  `COLLECTIONS.*`, never string literals.
- `src/lib/hotelScope.ts` — `hotelCollection`/`hotelDoc` path helpers, used
  from `firebase-admin` in Cloud Functions the same way the client uses them.
- `src/lib/audit.ts` — pattern to extend (server‑side, via `firebase-admin`)
  for the AI audit trail (Phase 12), rather than a new logging mechanism.
- `firestore.rules` `role()`/`hotel()` logic — the Permission Guard should
  mirror this exactly (see Authorization integration below).

## Database changes

No changes to existing collections. Two new hotel‑scoped collections,
consistent with the existing `hotels/{hotelId}/{collection}` tenancy model:

- `hotels/{hotelId}/aiConversations/{conversationId}` + subcollection
  `messages` — Conversation Manager.
- `hotels/{hotelId}/aiPendingActions/{actionId}` — Confirmation Manager;
  short‑lived, one doc per unconfirmed write, expired/deleted after use.

The existing `hotels/{hotelId}/auditLog` collection is reused as‑is for
Phase 12 (add `source: "ai"` to distinguish AI‑initiated entries from
UI‑initiated ones — additive field, no migration).

`firestore.rules` needs two additive rule blocks for the new collections
(hotel‑scoped read for the user's own hotel; writes only via Admin SDK from
Cloud Functions, mirroring how `auditLog` is already write‑restricted).

## Dependencies required

Root `package.json`: none for Phases 2–9.

New `functions/package.json`:
- `firebase-functions`, `firebase-admin` (runtime, not dev, in this package)
- One LLM SDK matching the eventual `AI_PROVIDER` choice — deferred to
  Phase 3 per the brief ("do not over‑engineer this")

## Authentication integration

Reuse Firebase Auth as‑is. The callable function's `context.auth.uid` is
verified by Firebase itself before the function body runs — this is the one
piece of "authenticated context" that can never be spoofed by the client,
and it's what the whole Permission Guard is anchored to.

## Authorization integration

Cloud Function looks up `users/{uid}` server‑side via `firebase-admin`
(mirroring `AuthProvider.tsx`'s client‑side lookup and `firestore.rules`'s
`role()`/`hotel()` functions) to get `role` and `hotelId`. This is the
`ToolContext` (`userId`, `hotelId`, `role`, `permissions`) passed to every
tool. The model is only ever shown tool *results*, never asked to supply or
confirm `hotelId`/`role`.

## Property/tenant isolation strategy

Identical to the existing app: every tool call is parameterized by the
server‑derived `hotelId` and reads/writes exclusively under
`hotels/{hotelId}/...` via `hotelCollection`/`hotelDoc`. No tool accepts a
`hotelId`/`propertyId` argument from the model — this is the direct
Cloud‑Functions equivalent of what `firestore.rules` already enforces for
the client SDK.

## AI provider strategy

`AIProvider` interface (per brief §6) implemented once behind
`functions/src/ai/provider.ts`, selected by `AI_PROVIDER`/`AI_MODEL`
Cloud Functions config/secrets (`firebase functions:secrets:set`), not Vite
env — this repo's existing `VITE_*` convention is for values safe to ship to
the browser, which an LLM API key is not. `.env.example` gets
non‑`VITE_` placeholders purely as documentation of what the Functions
deployment needs.

## Tool architecture

Each tool: `{ name, description, inputSchema (zod or similar), handler(ctx: ToolContext, input) }`, registered in `toolRegistry.ts`. Handlers call
existing Firestore paths via `hotelScope.ts` equivalents and existing
calculation helpers (`metrics.ts`/`pms.ts`) — never raw ad‑hoc queries.
Read tools (Phase 4) return data only. Write tools (Phase 10) additionally
require a `confirmationToken` issued by `confirmationManager.ts` from a
prior "would you like to confirm?" turn — the model cannot skip this by
itself.

## UI integration point

New nested route under the existing `/dashboard` shell
(`src/dashboard.tsx` + `App.tsx`), following the exact pattern already used
by `reservations`, `room-board`, etc. — a new sidebar icon/link, not a
separate app shell or standalone page.

## Testing strategy

- Extend `tests/rules/` (already using `@firebase/rules-unit-testing` and
  the Firestore emulator) to cover the two new collections'
  rules — this is a working harness already in the repo, not a new one.
- New `functions/` package gets its own Vitest suite for: tool input
  validation, Permission Guard (same cross‑tenant/privilege‑escalation cases
  as `firestore.rules` today, since the Guard duplicates that logic in
  Admin‑SDK land), orchestrator tool‑selection given the Phase 15 sample
  questions, and confirmation‑flow state transitions.
- `docs/ai/EVALUATION.md` (Phase 16) holds the 20+ question set; a small
  script runs them against the deployed function in a non‑prod project.

## Risks

- **Dual booking sources** (`accomodation` vs `reservations`) can make
  `get_reservations` (reads `RESERVATIONS`) disagree with `get_occupancy`
  (reads `BOOKINGS` via `metrics.ts`) for a hotel actively using the newer
  front‑desk flow. Flagging now rather than discovering it via a wrong AI
  answer later; worth deciding whether to unify the two before or after V1.
- **New backend surface.** Cloud Functions is new infrastructure for this
  project (new deploy target, secrets management, cold starts, cost) — this
  was flagged in Phase 0 and still applies; needs your sign‑off before
  Phase 2 creates the `functions/` package.
- **No existing error/observability layer** to extend — Phase 13's
  structured logging will be new, not a retrofit of something existing.

---

PHASE COMPLETE: Phase 1 — Implementation Plan
Implemented:
- Resolved the two Phase 0 open items via targeted grep/route inspection
  (booking‑collection duplication; absence of housekeeping/maintenance/
  night‑audit implementations); produced the plan above
Files created:
- docs/ai/PHASE_1_PLAN.md (this document)
Files modified:
- none
Dependencies added:
- none
Database changes:
- none (planned, not applied)
Tests:
- none (planning only)
Validation:
- lint: not run (no code changed)
- typecheck: not run (no code changed)
- build: not run (no code changed)
Risks / outstanding issues:
- Dual booking collections (accomodation vs reservations) — decision above
  proposed, needs your confirmation
- Housekeeping/maintenance tools deferred out of V1 — needs your confirmation
- New Cloud Functions backend requires your sign‑off before Phase 2
NEXT PHASE:
Phase 2 — AI Infrastructure
STATUS:
WAITING FOR APPROVAL
