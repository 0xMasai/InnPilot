# Phase 0 — Repository Inspection & Architecture Assessment

Repo: `0xMasai/hotel-ms` (InnPilot). Inspected read‑only; no application code,
dependencies, database, env files, UI, or AI functionality were touched.

## 1. Architecture assessment

- **Frontend‑only SPA.** React 19 + TypeScript + Vite 7, React Router v7,
  Tailwind v4 + MUI, Framer Motion. Also shipped as a desktop app via
  Electron (`electron/main.cjs`, electron‑builder config in `package.json`).
- **Backend: Firebase, client SDK only.** `firebase` (client SDK) is a
  dependency; `firebase-admin` and `firebase-tools` are dev‑only (used by
  `scripts/admin/bootstrap.ts` and `migrate.ts`, run locally, not deployed).
  **There is no server/API layer, no Cloud Functions directory, and no
  server actions anywhere in the repo.** Every page talks to Firestore
  directly through the client SDK.
- **Auth:** Firebase Auth. `src/auth/AuthProvider.tsx` is the single source
  of truth for `user`, `role`, `hotelId` — resolved live via `onSnapshot` on
  `users/{uid}`. `src/auth/ProtectedRoute.tsx` gates routes by role, with a
  dedicated "pending / not yet active" screen.
- **Authorization:** Role-based — `super_admin | hotel_admin | staff | pending`
  (`src/types/models.ts`). Enforced twice: client‑side via `ProtectedRoute`
  (UX only) and authoritatively via `firestore.rules` (162 lines), which
  re‑derives `role()`/`hotel()` server‑side from `users/{uid}` on every
  request — this is the actual security boundary today.
- **Multi‑tenancy:** Path‑based. Operational collections live under
  `hotels/{hotelId}/{collection}/{docId}` (`src/lib/hotelScope.ts`); a
  client literally cannot address another hotel's documents without that
  hotel's id appearing in the path, and rules check the caller belongs to it.
  `users/{uid}` is the one top‑level exception (needed to resolve
  role/hotelId from a bare uid before the app knows which hotel to query).
- **Database:** Firestore only (no SQL, no ORM). Collection name constants
  live in `src/lib/collections.ts`.
- **Existing service/business‑logic layer:** thin but real —
  `src/lib/pms.ts` (booking overlap, occupancy rate, money formatting, date
  helpers), `src/lib/metrics.ts` (centralized revenue/expense/occupancy
  calculations — explicitly documented as the single source every dashboard
  and report must use), `src/lib/audit.ts` (append‑only audit log writer,
  fire‑and‑forget, already scoped per hotel).
- **Existing reporting/dashboards:** `src/Overview.tsx`, `src/Reports.tsx`,
  plus module pages (`Accommodation`, `Restaurant`, `Conference`, `Expenses`,
  `Guests`, `Users`, `AuditLog`) rendered inside `src/dashboard.tsx`, a
  role‑aware shell with sidebar nav and nested routes (`<Outlet/>`).
  `Reports.tsx` already uses `jspdf`/`jspdf-autotable` for exports.
- **Logging/error handling:** No centralized logger; ad hoc
  `console.error`/toast (`react-toastify`) at call sites. Audit log
  (`auditLog` collection) is the one structured, persisted trail today —
  immutable by Firestore rule (no update/delete permitted).
- **Environment configuration:** `firebase.ts` (client config) + `dotenv` for
  local scripts. No `.env.example` currently present in the repo root.
- **Deployment:** Static SPA (Vite build) — README/host config didn't surface
  a specific host in this pass; also packaged as Electron desktop
  (win/mac/linux) via electron‑builder.
- **Testing:** Vitest. `tests/rules/` exercises `firestore.rules` with
  `@firebase/rules-unit-testing` — a directly reusable pattern for testing
  AI tool authorization later. `tests/pms.test.ts` covers `src/lib/pms.ts`.

## 2. Existing data/service map

| Entity | Where | Notes |
|---|---|---|
| Hotel/property | `hotels/{hotelId}` doc, `HotelDoc` in `src/types/models.ts` | name, location, subscription (plan/status) |
| User | `users/{uid}` (top‑level), `UserDoc` | role, hotelId, createdBy |
| Staff | same `users` collection, `role: staff` | no separate staff entity |
| Rooms | `hotels/{hotelId}/rooms`, `COLLECTIONS.ROOMS` | status: Available/Occupied/Cleaning/Maintenance/Out of Service |
| Room status | field on room doc | `RoomStatus` type in `collections.ts` |
| Reservations/bookings | `COLLECTIONS.BOOKINGS` = Firestore collection `"accomodation"`; also `COLLECTIONS.RESERVATIONS` = `"reservations"` | two related collections — needs confirmation of how they differ before building tools on them |
| Guests | `src/Guests.tsx` page; no dedicated `guests` collection constant found in `collections.ts` | likely derived from booking records — verify in Phase 1 |
| Restaurant/F&B | `COLLECTIONS.RESTAURANT` = `"restaurant"` | `src/Restaurant.tsx` |
| Conference/events | `COLLECTIONS.CONFERENCE` / `CONFERENCE_SPACES` | `src/Conference.tsx` |
| Expenses | `COLLECTIONS.EXPENSES` | `src/Expenses.tsx`, `ExpenseRecord` in `metrics.ts` |
| Payments | `COLLECTIONS.PAYMENTS`, `FOLIO_ITEMS` | folio/payment model exists at the collection‑name level; UI surface not yet confirmed |
| Revenue | derived, not stored directly | computed in `src/lib/metrics.ts` from bookings + restaurant + conference |
| Maintenance | `COLLECTIONS.MAINTENANCE` = `"maintenanceRequests"` | referenced in schema, page not yet located |
| Housekeeping | `COLLECTIONS.HOUSEKEEPING_TASKS` | referenced in schema, page not yet located |
| Reports | `src/Reports.tsx` | PDF export via jsPDF |
| Audit | `COLLECTIONS.AUDIT` = `"auditLog"`, `src/lib/audit.ts`, `src/AuditLog.tsx` | already append‑only and hotel‑scoped — the AI audit trail (Phase 12) should extend this, not fork a new mechanism |
| Night audit | `COLLECTIONS.NIGHT_AUDITS` | referenced in schema, not yet inspected |

Everything above was read from the actual repo (`collections.ts`, `models.ts`,
`hotelScope.ts`, `metrics.ts`, `audit.ts`, `dashboard.tsx`) — no names were
assumed.

## 3. AI integration strategy

The single fact that should drive every later phase: **this app has no
backend today.** All existing "services" (`pms.ts`, `metrics.ts`, `audit.ts`)
are plain TypeScript functions that run in the browser against the Firestore
client SDK. That is fine for CRUD gated by Firestore security rules, but it
is not a safe place for:

- an LLM API key (would ship to every client bundle), or
- authorization decisions that must be trusted (a compromised or modified
  client could otherwise self‑assert `hotelId`/`role` to the model).

**Recommendation:** introduce Firebase Cloud Functions (callable functions,
`onCall`) as the *only* new backend component, and make that the AI Gateway
+ Tool execution layer:

```
Client (Ask InnPilot UI)
  → Firebase Callable Function "aiChat" (Gateway + Orchestrator)
      - context.auth.uid is server‑verified by Firebase, not client‑supplied
      - re‑derive role/hotelId server‑side from users/{uid} (mirrors
        firestore.rules logic, e.g. shared via a small server util)
      - Tool Registry + Permission Guard run here
      - Tools call Firestore via firebase-admin (bypassing security rules
        intentionally, because the Guard *is* the authorization check here)
      - Confirmation Manager persists pending write‑confirmations server‑side
      - Audit Logger appends to the existing hotels/{hotelId}/auditLog
  → returns structured AI response + tool activity to client
```

This keeps the "LLM never touches the DB directly" and "authenticated
context is server‑generated" requirements satisfiable, reuses the existing
tenant model (`hotels/{hotelId}/...`) and audit log, and is the smallest
addition that makes the rest of the brief buildable — everything else
(tools, prompt, UI, briefing, write confirmation, audit, eval) can sit on
top of this one new primitive.

## 4. Proposed files to create/modify (indicative — finalize in Phase 1)

New (Cloud Functions, not yet present — would need a `functions/` package):
`functions/src/ai/gateway.ts`, `orchestrator.ts`, `toolRegistry.ts`,
`permissionGuard.ts`, `confirmationManager.ts`, `auditLogger.ts`,
`tools/read/*.ts`, `tools/write/*.ts`, `systemPrompt.ts`.

New (frontend): an "Ask InnPilot" panel/page wired into `dashboard.tsx`'s
existing nav + `<Outlet/>` pattern, a thin client for calling the callable
function, and UI states for loading/tool‑activity/confirmation/error.

Likely untouched: `src/lib/metrics.ts`, `src/lib/pms.ts`, `firestore.rules`,
all existing pages — tools should call into or mirror `metrics.ts`'s
calculations rather than reimplementing them, per "do not rewrite InnPilot."

## 5. Required dependencies (indicative)

`firebase-functions`, `firebase-admin` (already a devDependency, would need
to be a runtime dependency inside `functions/`), an LLM SDK per the chosen
`AI_PROVIDER`. No frontend dependency changes anticipated for Phase 2–7.

## 6. Database changes

No schema changes required for read tools (Phase 4) — they read existing
collections. Later phases likely need two new hotel‑scoped collections:
one for AI conversations/messages (Conversation Manager) and one for pending
write‑confirmations (Confirmation Manager), plus reuse of the existing
`auditLog` collection for Phase 12 rather than a new one.

## 7. Security considerations

- `firestore.rules` already encodes the authorization model
  (`role()`, `hotel()`, `hotelAdmin()`, `hotelStaff()`, tenant‑field checks).
  The Permission Guard in Cloud Functions should mirror this logic exactly
  (ideally via a shared helper) rather than re‑deriving it independently, to
  avoid the two drifting apart.
- `users/{uid}` is the trust root for role/hotelId today — the Guard must
  read this server‑side per request, never accept role/hotelId from the
  client or let the model set them.
- The existing audit log is immutable by rule (no update/delete) — the AI
  audit trail should honor the same guarantee.
- Existing `tests/rules/` gives a working harness for writing the Phase 5
  cross‑tenant/privilege‑escalation tests against the same emulator setup.

## 8. Risks

- No backend currently exists — Cloud Functions is a new piece of
  infrastructure for this project (new deploy target, cold starts, cost),
  not just new application code. Needs explicit sign‑off before Phase 2.
- Two candidate booking collections (`accomodation` vs `reservations`) need
  disambiguation before Phase 4 tools are written against either.
- Guests, night‑audit, housekeeping, and maintenance pages/collections are
  named in `collections.ts` but their reading/writing pages weren't located
  in this pass — needs a follow‑up look before those tools are implemented.
- Electron desktop distribution means the "Ask InnPilot" UI must work
  offline‑tolerant (or gracefully degrade) if that channel matters for V1.

## 9. Phase‑by‑phase implementation plan

Unchanged from `INNPILOT_AI_BRIEF.md` §"Phase list" — Phase 1 will turn this
into concrete file‑level tasks once the two open items above (booking
collection disambiguation, guest/housekeeping/maintenance page locations)
are resolved.

---

PHASE COMPLETE: Phase 0 — Repository Inspection
Implemented:
- Read‑only inspection of 0xMasai/hotel-ms (structure, package.json, auth,
  Firestore rules, data model, lib/service layer, dashboard shell, tests)
Files created:
- docs/ai/INNPILOT_AI_BRIEF.md (persistent copy of this brief)
- docs/ai/PHASE_0_ASSESSMENT.md (this document)
Files modified:
- none
Dependencies added:
- none
Database changes:
- none
Tests:
- none (inspection only)
Validation:
- lint: not run (no code changed)
- typecheck: not run (no code changed)
- build: not run (no code changed)
Risks / outstanding issues:
- No backend exists yet — Cloud Functions is new infrastructure, needs sign‑off
- `accomodation` vs `reservations` collections need disambiguation
- Guests / night‑audit / housekeeping / maintenance pages not yet located
NEXT PHASE:
Phase 1 — Implementation Plan
STATUS:
WAITING FOR APPROVAL
