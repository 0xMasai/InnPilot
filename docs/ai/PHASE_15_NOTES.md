# Phase 15 — Production Hardening & Release Readiness

## Objective

Take the existing AI + MCP + WebMCP functionality to a genuinely
production-ready state: audit the whole request path for security,
integrity, reliability and observability problems; fix confirmed issues
(rather than only documenting them); and add regression tests that fail if a
protected behaviour is broken. No new product features were added.

## Important context: working-tree vs. the stated Phase 14 baseline

The handover described a completed, verified **Phase 14 — Voice
Architecture** (browser speech recognition/synthesis, `inputMode: text |
voice`, `VITE_AI_VOICE=off`, `speakableText()`, voice audit metadata, voice
tests) and prior Phase 12/13 work.

The working tree audited here is `main` @ `bc135ba`. On disk:

- **No voice code exists anywhere.** Searches for `inputMode`,
  `speakableText`, `VITE_AI_VOICE`, `SpeechRecognition`, `speechSynthesis`,
  `dictation`, `microphone` return nothing under `src/`, `server/` or
  `tests/`. The only `voice` match is marketing copy in `src/pages/home.tsx`.
- **No `PHASE_11`–`PHASE_14` notes** exist in `docs/ai/` (they stop at
  `PHASE_10_NOTES.md`).
- **The server-side audit logger was present but never called** (see
  Finding 1). The orchestrator header still declared audit logging
  "deliberately absent (Phase 12)".

So the working tree does **not** contain Phase 12 (server audit wiring),
Phase 13 (structured logs), or Phase 14 (voice). The `test:ai → 209 passed`
figure in the handover cannot correspond to this tree, which has no voice
tests. This is reported, not worked around: Phase 15 hardened the code that
is actually present and did **not** fabricate voice hardening for code that
does not exist.

> If the intended Phase 12–14 work lives on another branch/remote that was
> never merged into this `main`, that merge should happen and this phase
> re-run against the result.

## Verification limitation (read this before trusting the checklist)

This phase was executed in an environment **without a shell**: `git`, `npm`,
`npx tsc`, `npm run build`, `vitest`, and `eslint` could not be run. All
findings are from static reading of the source, and all code changes are
**unverified by build/test on this machine**. The changes were written
conservatively and defensively, but the maintainer must run the full suite
(see "Final verification — must be run by you") before treating Phase 15 as
complete. Nothing below claims to have been executed here.

## Audit findings (verified by inspection)

The codebase was already strongly hardened. The following boundaries were
read and hold up:

- **Auth & identity.** `api/ai-chat.ts` verifies the Firebase ID token;
  `server/ai/aiChat.ts` re-verifies and never trusts a client-supplied
  uid/hotelId/role. `contextManager.ts` is the single place role/hotelId are
  resolved, read server-side from `users/{uid}`; unknown roles coerce to
  `pending`.
- **Tenant isolation (server tools).** Every `dataAccess.ts` path is
  `hotels/{ctx.hotelId}/…`; no tool accepts a `hotelId` argument
  (`tenantIsolation.test.ts` asserts a supplied `hotelId` is rejected as an
  undeclared property).
- **RBAC.** Write tools are `STAFF_AND_ADMIN` only; `permissionGuard.ts`
  mirrors `firestore.rules`; `pending` users are blocked at the gateway.
- **Confirmation flow.** Writes never execute on the model's word. A
  pending action is single-use, 5-minute-expiring, and bound to
  hotel+user+conversation+tool+validated-input; the confirmation id is never
  placed in the model transcript; the role is **re-checked at confirm time**;
  the tool + args come from the stored action, not the confirming request.
- **CORS.** Unset `ALLOWED_ORIGINS` grants nothing (no `*` default); only
  exact listed origins are echoed.
- **Firestore rules.** `auditLog` is append-only (`update, delete: if
  false`) and `create` requires `own()` (so `userId == request.auth.uid` —
  a client cannot forge another user's row); the catch-all denies client
  access to `aiPendingActions` / `aiConversations` (Admin-SDK only). Rules
  were **not** changed in this phase.
- **Reservation creation (WebMCP).** `createReservation()` validates room
  existence, maintenance state and **date-overlap conflicts** against both
  `reservations` and legacy `accomodation` before writing to the canonical
  `reservations` collection with `userId` set — the same collection the PMS
  UI reads. Availability cannot be skipped from the tool layer.
- **Error handling.** The gateway returns chosen, non-revealing sentences
  and logs internals server-side only; `aiClient.ts` handles aborts, network
  failure, non-JSON error bodies and malformed replies without leaking
  internals.
- **Secrets.** None committed. `.gitignore` blocks `.env` and
  `*serviceAccountKey*.json`; `admin.ts` never echoes the key on parse
  failure.

## Problems discovered

1. **(High, confirmed & fixed) Server-gateway AI mutations were not
   audit-logged.** `server/ai/auditLogger.ts::logAiAction` was defined but
   **called nowhere** in the repo. Confirmed writes via "Ask InnPilot"
   (`update_room_status`, `update_reservation_status`) changed Firestore but
   left no attributable audit row — while the client WebMCP path *does*
   audit via `logAction`. This violates the "every AI action is
   attributable" principle and the Phase 15 observability criteria.

2. **(Medium, reliability — documented, not fixed) TOCTOU double-booking
   race in `createReservation()`.** It loads reservations, checks overlap,
   then `addDoc()`s — not atomic. Two concurrent creates for the same
   room/date can both pass the overlap check and double-book. A correct fix
   needs a Firestore transaction or a per-room/date lock document and would
   change canonical booking behaviour; it was **not** attempted blind in a
   no-test environment. See "Remaining risks".

3. **(Low, hygiene — fixed) Stale orchestrator header** claimed audit
   logging and structured logs were "deliberately absent (Phase 12/13)".

4. **(Process — reported) Working tree diverges from the stated Phase 14
   baseline** (see the context section above).

## Fixes implemented

- **Wired audit logging into confirmed AI writes** (`orchestrator.ts`):
  `executeConfirmed()` now records exactly one audit row per executed
  mutation — on **success**, on **failure** (write threw), and on
  **denial** (role revoked between propose and confirm). A new
  `auditConfirmedWrite()` helper maps the tool to its entity and derives
  `entityId` from the resolved document id. Reads are **not** audited
  (matches the WebMCP contract). Proposals are not audited (nothing changed
  yet); the single confirmed-execution row records that confirmation was
  required *and* supplied (`confirmationStatus: "confirmed"`).
- **Made `logAiAction` fail-safe** (`auditLogger.ts`): the whole body is now
  wrapped in `try/catch`, not just the async write, so a missing/misconfigured
  Firestore handle can never throw synchronously into a user's action. Audit
  logging can never block or break a confirmed write.
- **Declared audit metadata on write tools**: `auditEntity: "room"` /
  `"booking"` added to the two write tools, and each write handler now
  returns the resolved `id` so audit rows point at the exact record changed.
- **Added `AuditEntity` to the shared tool contract** (`types.ts`) with an
  optional `auditEntity` on `ToolDefinition`; `auditLogger.ts` re-exports the
  type for backwards compatibility.
- **Updated the orchestrator header** to describe the audit behaviour that
  now exists.

The audit row schema is unchanged from Phase 12 (`source: "ai"`,
`conversationId`, `toolName`, `confirmationStatus`, `success`, plus the
standard `action/entity/entityId/details/userId/userEmail/hotelId/at`), so
the existing admin `AuditLog` reader renders these rows without change.

## Security improvements

- Every confirmed AI mutation is now attributable: **who** (`userId` +
  `userEmail`), **which hotel**, **which tool**, **which record**
  (`entityId`), **result** (`success`), **confirmation** (`confirmationStatus:
  "confirmed"`), and **when** (`serverTimestamp`). This closes the gap
  between an action happening and it being observable/reviewable.
- Audit logging is now provably decoupled from action success — a logging
  failure cannot deny or corrupt a legitimate write.

## Tests added

- `tests/ai/auditLogging.test.ts` (new):
  - a confirmed room-status change logs exactly one row with the right
    actor/hotel/entity/entityId/success;
  - a confirmed reservation change is attributed to the `booking` entity;
  - a write denied at confirm time (user demoted) logs `success: false` and
    writes nothing;
  - read-only tool calls log **nothing**;
  - a proposed-but-unconfirmed write logs nothing;
  - an invented confirmation id changes and logs nothing;
  - a contract test: **every** registered write tool must declare
    `auditEntity` (fails closed when a new write tool omits it).
- `tests/ai/writeConfirmation.test.ts` (edited): stubs `auditLogger` so it
  stays focused on the write/confirmation boundary; all existing assertions
  are unchanged.

These fail if the audit wiring is removed or a write tool is added without
an entity — i.e. they protect the fix.

## Deployment considerations

- **`ALLOWED_ORIGINS`** — leave unset for the same-origin Vercel deployment;
  set exact origins only if the UI is served from a different origin than the
  function. No wildcard is ever emitted.
- **`FIREBASE_SERVICE_ACCOUNT`**, **`AI_API_KEY`**, `AI_PROVIDER/MODEL/…` —
  Vercel project env vars only, never in the repo. The service-account key is
  a full rules bypass; secret store only.
- **`VITE_*`** values are bundled into public browser JS by design — no
  secret may carry that prefix (documented in `.env.example`).
- **`VITE_AI_VOICE`** — referenced in the handover but **not present** in
  this tree; there is nothing to configure until voice code lands.
- `vercel.json` sets `api/ai-chat.ts` `maxDuration: 60`, consistent with the
  orchestrator's 3-round / 8-call budget.

## Known limitations

- Voice (Phase 14) is absent from this tree; none of the voice acceptance
  criteria could be exercised, and no voice hardening was performed.
- Verification commands were not runnable in this environment (no shell);
  all changes are unverified locally.
- Server-side structured logging (Phase 13) is not present; the code uses
  `console.error` for server-side failures.

## Remaining risks

- **Double-booking race** in `createReservation()` (Finding 2) — real but
  low-frequency; recommended fix: perform the overlap check and the write
  inside a Firestore transaction keyed on a deterministic room/date lock
  document, so concurrent creates for the same room serialise.
- **Divergent Phase 12–14 work** may exist unmerged; reconcile branches
  before release (Finding 4).
- Audit rows are best-effort by design (fire-and-forget): a persistent
  Firestore outage means a successful write may go unlogged. This matches the
  existing `src/lib/audit.ts` contract and is the intended trade-off (never
  block the user), but it means the trail is not a guaranteed ledger.

## Final acceptance criteria — status

| Criterion | Status |
|---|---|
| Production-critical security boundaries reviewed | ✅ by inspection |
| Tenant isolation verified | ✅ by inspection + existing tests |
| AI authorization verified | ✅ by inspection + existing tests |
| MCP/WebMCP authorization verified | ✅ by inspection (client SDK under rules) |
| Reservation mutations vs. canonical PMS data | ✅ by inspection (shared `reservationService`) |
| Confirmation protections verified | ✅ existing `writeConfirmation.test.ts` |
| Audit logging verified | ✅ **fixed + new tests** (server gateway now logs) |
| Voice failure behaviour verified | ⛔ N/A — no voice code in tree |
| Important error paths covered | ✅ by inspection |
| Production env configuration reviewed | ✅ |
| Regression tests added | ✅ `tests/ai/auditLogging.test.ts` |
| Existing tests remain green | ⚠️ **not run here** — must be verified |
| TypeScript passes | ⚠️ **not run here** — must be verified |
| Production build passes | ⚠️ **not run here** — must be verified |
| Lint clean for touched files | ⚠️ **not run here** — must be verified |
| Documentation updated | ✅ this file |
| No secrets introduced | ✅ |
| Git diff reviewed | ✅ by re-reading each changed file |

## Final verification — must be run by you

```bash
npm install
npx tsc -b
npm run build
npm run test:ai
npm run test:rules
npm run lint
git diff        # review the touched files below
```

Files changed in Phase 15:

- `server/ai/orchestrator.ts` — audit wiring + header
- `server/ai/auditLogger.ts` — fail-safe body + shared `AuditEntity`
- `server/ai/types.ts` — `AuditEntity` + `ToolDefinition.auditEntity`
- `server/ai/tools/write/rooms.ts` — `auditEntity`, output `id`
- `server/ai/tools/write/reservations.ts` — `auditEntity`, output `id`
- `tests/ai/auditLogging.test.ts` — new
- `tests/ai/writeConfirmation.test.ts` — stub audit logger
- `docs/ai/PHASE_15_NOTES.md` — this file
