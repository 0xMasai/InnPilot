# InnPilot — Production Readiness Audit

**Date:** 2026-09-02
**Scope:** Full repository — architecture, auth, multi-tenancy, RBAC, Firestore, AI execution chain, AI writes, WebMCP, secrets/config, deployment, tests, migrations, operability, documentation.
**Method:** Repository documentation used as source of truth, then compared against actual implementation. No code was changed. Tests were read and structurally reviewed but **not executed** (no Node/Firebase-emulator runtime available in this environment).

---

## PRODUCTION READINESS

**Overall: NOT READY** — blocked by a small number of P0 issues, all fixable quickly. The core is genuinely strong: the server-side AI security model (tenant isolation, permission guard, atomic confirmation-gated writes, audit logging) is well-engineered and well-tested. The blockers are a leaked credential, a client-side dev auth path shipping in production, a fail-open role default, and an unconfirmed AI write path via WebMCP that contradicts the project's own mandate.

Once the P0 items are resolved, InnPilot is close to a defensible multi-tenant production posture.

---

## Source-of-truth reconciliation (contradictions found)

The repo contains **two independent AI architectures**, and the documentation does not reconcile them:

1. **Server-side AI gateway** — `server/ai/*` + `api/ai-chat.ts` + the "Ask InnPilot" UI (`src/pages/pms/AskInnPilot.tsx`). Documented in `docs/ai/INNPILOT_AI_BRIEF.md` and `docs/ai/PHASE_0..6`. This is the production AI path. Its write model is confirmation-gated and server-verified.
2. **WebMCP browser tools** — `src/webmcp/*`. Documented in `docs/webmcp/PHASE_1..2` and the README. Exposes read **and write** tools to any external agent (e.g. ChatGPT) that supports `document.modelContext`. Its write model is **direct execution, no confirmation**.

The top-level `README.md` documents **only** WebMCP and asserts *"There is no MCP server and no bundled chatbot"* — directly contradicting the shipped server-side gateway and the Ask InnPilot chatbot. Treat this as the newest requirement conflict: both subsystems are live in code, so both must be held to the mandate's "AI writes remain confirmation-gated" requirement. WebMCP currently is not (see P0-4).

The `docs/ai/INNPILOT_AI_BRIEF.md` defines 17 phases. Phase notes exist only for 0–6, yet code for phases 7 (system prompt), 8 (Ask UI), 10 (write tools), 12 (audit), 13 (observability), 14 (voice) is present and tested. So later phases were implemented but never documented, and phases 16 (evaluation dataset) and 17 (ARCHITECTURE/TOOLS/SECURITY/EVALUATION docs) appear **not delivered** — the four documents named in Phase 17 do not exist in the repo.

---

## P0 — Production blockers

### P0-1 — Live secret credentials present in `.env` (working tree)

- **Problem:** `.env` contains a real, usable OpenAI API key (`sk-proj-…`, full value present) and real Firebase web config. `.env` is correctly listed in `.gitignore` (line 31), so it is almost certainly not in git history — but the live key exists in plaintext on disk and has been exposed outside the machine (it was shared into this session).
- **Evidence:** `.env` line 15 (`AI_API_KEY=sk-proj-…`), lines 1–8 (Firebase config), `.gitignore` line 31.
- **Affected:** `.env`, any deployment reusing this key.
- **Why it blocks:** An exposed billable API key can be drained by anyone who holds it. Even absent git history, "a real secret has left the host" is a rotate-now event.
- **Fix:**
  1. **Rotate the OpenAI key immediately** in the OpenAI dashboard; set the new value only in Vercel's Environment Variables (secret store), never in `.env`.
  2. Confirm the key is not in git history: `git log -p --all -S 'sk-proj' -- .env` (expect no results). If it ever was committed, rotate is still the fix and history should be scrubbed.
  3. Firebase web API keys are not secrets by design, but confirm Firebase Auth authorized domains and App Check are configured so the config cannot be abused from arbitrary origins.

### P0-2 — Development auth path ships in production client code

- **Problem:** `AuthProvider.tsx` treats a `localStorage["user"]` blob as a signed-in session, fabricating a `FirebaseUser` with `getIdToken: () => "dev-token"`, `role: hotel_admin`, `hotelId: hotel_demo_01`. `aiClient.ts` mirrors this, sending `Bearer dev-mock-token` when there is no real Firebase user but a localStorage user exists. This is a client-side authentication bypass baked into the shipped bundle.
- **Evidence:** `src/auth/AuthProvider.tsx` `syncLocal()` (lines 51–84, 121, 131); `src/lib/aiClient.ts` lines 127, 135–140.
- **Affected:** `AuthProvider.tsx`, `aiClient.ts`, every `ProtectedRoute`.
- **Why it blocks:** Anyone who sets a `localStorage` key is rendered the full hotel-admin dashboard shell without authenticating. This is exactly the "development-only behavior accidentally present in production" the mandate flags (#18). **Mitigating fact:** real Firestore reads/writes still require a valid Firebase ID token, and the server gateway rejects `dev-mock-token` via `verifyIdToken`, so this does **not** expose live tenant data — but it defeats the app's access-control UX and must not ship.
- **Fix:** Gate the entire localStorage path behind `import.meta.env.DEV` (compiled out of production builds), or remove it. Do the same for the `dev-mock-token` branch in `aiClient.ts`.

### P0-3 — Role resolution fails open to `hotel_admin` / `hotel_demo_01`

- **Problem:** In `AuthProvider.tsx`, when the user's Firestore profile is missing/invalid, or the `onSnapshot` errors, `role` defaults to `hotel_admin` and `hotelId` to `hotel_demo_01`. Critically, a genuine `pending` role is **not** in the valid-role allowlist, so a pending (unapproved) user is coerced to `hotel_admin`.
- **Evidence:** `src/auth/AuthProvider.tsx` lines 106–118 (`validRole = … ? r : "hotel_admin"`; pending excluded), 114–118 (error fallback), 110 (`?? "hotel_demo_01"`).
- **Affected:** `AuthProvider.tsx`, `ProtectedRoute.tsx` (its `role === "pending"` branch is effectively dead code — AuthProvider never yields `pending`).
- **Why it blocks:** Fail-open is the wrong default for an access-control primitive. The "not yet active" screen never shows; unapproved users are presented an admin UI (data reads still fail against rules, but the UX contract and the mandate's role-transition/pending requirements are violated).
- **Fix:** Default unknown/missing/errored role to `pending` (or `null`) and `hotelId` to `null`. Include `pending` as a first-class valid role so `ProtectedRoute`'s pending screen works. Never hard-code `hotel_demo_01`.

### P0-4 — WebMCP write tools execute without confirmation gating (contradicts the mandate)

- **Problem:** WebMCP write tools (`innpilot_create_reservation`, `innpilot_update_reservation_status`, `innpilot_set_room_status`) call the underlying services and write to Firestore **directly**, with no propose→confirm→execute step. The mandate and `INNPILOT_AI_BRIEF.md` (Phases 10–11) require every AI write to be confirmation-gated and never executed on the model's say-so. The server gateway honors this; WebMCP does not.
- **Evidence:** `src/webmcp/tools/reservations.ts` `createReservationTool.execute` (calls `createReservation` then returns success, lines 62–92) and `updateReservationStatusTool` (calls `updateReservationStatus`, line 150); README "The toolset" lists these as agent-callable writes.
- **Affected:** `src/webmcp/tools/reservations.ts`, `src/webmcp/tools/rooms.ts`, `src/webmcp/registry.ts`.
- **Why it blocks:** An external agent connected to the browser can autonomously create or cancel bookings and change room status with no human confirmation — the precise capability the mandate says the AI must never hold. **Mitigating facts:** writes still pass Firestore rules (tenant + role enforced), run as the authenticated user, and are audited via `logAction(... "(agent)")`; and WebMCP is only active in experimental secure-context Chromium builds that implement `document.modelContext`, so real-world exposure today is near-zero. That mitigation is why this is a blocker-to-fix rather than an active breach, but it must be resolved (or the write tools disabled) before WebMCP is promoted for production use.
- **Fix (choose one):** (a) Ship WebMCP read-only in V1 — drop the three write tools; or (b) add a confirmation contract to WebMCP mirroring the server `confirmationManager` (propose returns a summary + id; a second tool call with the id executes); or (c) explicitly document WebMCP writes as out of production scope and feature-flag them off by default.

---

## P1 — High priority (fix before serious production use)

### P1-1 — No rate limiting or spend cap on the billable AI endpoint
The gateway bounds one turn (`MAX_TOOL_ROUNDS = 3`, `MAX_TOOL_CALLS_PER_TURN = 8`) but nothing caps how many turns one authenticated account can issue. A single account can loop and drain the API budget. This is called out honestly in `docs/ai/PHASE_5_NOTES.md` and `PHASE_6_NOTES.md` as the biggest outstanding gap. Add a per-user/per-window request cap (and ideally a global daily ceiling) in `server/ai/aiChat.ts` before the chat UI is broadly available. *Evidence:* `server/ai/orchestrator.ts` lines 84–91; Phase 5/6 notes "Risks".

### P1-2 — `.env` misconfigurations that break the gateway / CORS
The committed local `.env` has three issues that will bite in real deployments if copied: (1) `FIREBASE_SERVICE_ACCOUNT` is set to the service-account **email**, not the JSON/base64 the code requires — `admin.ts parseServiceAccount` will throw "not valid service-account JSON", crashing the gateway at init (affects `dev:ai`/`smoke` locally; production must set full JSON in Vercel); (2) `ALLOWED_ORIGINS=https://hotel-ms-six.vercel.app/` has a trailing slash — the browser `Origin` header never has one, so `allowed.includes(origin)` never matches and cross-origin CORS silently fails; (3) `VITE_AI_API_BASE=https://hotel-ms-six.vercel.app/` trailing slash yields a double-slash `…//api/ai-chat` endpoint. *Evidence:* `.env` lines 8, 17, 18; `server/admin.ts` lines 28–41; `api/ai-chat.ts` lines 26–33; `src/lib/aiClient.ts` line 96. *Fix:* Strip trailing slashes from origins/base URLs; document that production sets `FIREBASE_SERVICE_ACCOUNT` to full JSON. The `.env.example` is excellent and already says all this — the live `.env` just diverges from it.

### P1-3 — README is stale and contradicts the shipped system
The top-level `README.md` is the default Vite template plus a WebMCP section; it documents no server AI gateway, no deployment runbook, no bootstrap/env setup, and actively claims there is "no MCP server and no bundled chatbot" while both a gateway and the Ask InnPilot chatbot exist. Another engineer cannot deploy from it. *Fix:* Rewrite README with architecture (both AI paths), env setup (point at `.env.example`), Firebase/Vercel deploy steps, and the bootstrap/migrate flow (which `scripts/admin/README.md` already covers well — link it).

### P1-4 — Missing Phase 16–17 deliverables (evaluation set + architecture/security docs)
The brief's definition of done requires an evaluation dataset (Phase 16, "agent must pass before release") and `docs/ai/ARCHITECTURE.md`, `TOOLS.md`, `SECURITY.md`, `EVALUATION.md` (Phase 17). None exist. End-to-end tool-selection and answer accuracy are therefore **unverified against a live provider** (the sandbox blocked egress; Phase 6 notes acknowledge this). *Fix:* Add the evaluation set and run it against the real provider before release; author the four Phase-17 docs.

### P1-5 — AI conversation history stores guest PII with no retention/redaction policy
`aiConversations` stores the manager's raw questions and tool-derived guest names (PII). The audit log is redacted at write (`server/ai/redact.ts`), but conversation history is not, and there is no retention/deletion policy. Flagged in Phase 5 notes as "Phase 12's problem". *Fix:* Define retention + a redaction/expiry policy for `aiConversations` before onboarding real guest data.

---

## P2 — Medium priority

- **P2-1 — Legacy `accomodation` (misspelled) collection persists as a dual read/write surface.** Rules, migration, and tools all still address both `reservations` and legacy `accomodation`. Intentional for backward-compat, but it doubles the tenant surface and the reasoning burden. Plan a cutover and eventual removal (migration already preserves it as a backup). *Evidence:* `firestore.rules` lines 74–79; `scripts/admin/migrate.ts` line 50; `docs/webmcp/PHASE_2_TOOLS.md`.
- **P2-2 — `folioItems` / `payments` have Firestore rules and types but no service, UI, or write path.** Money-handling is declared but unbuilt. Fine to defer, but the rules exist ahead of the feature; ensure no tool or client assumes they are populated. *Evidence:* `firestore.rules` 88–100; README + Phase 2 notes.
- **P2-3 — `firestore.indexes.json` absent.** No composite indexes are declared in the repo. Current tool reads fetch collections and filter in memory (bounded), so this may be intentional, but any future ordered/compound query will fail in production until an index is added. Add the file (even empty) and a note.
- **P2-4 — Electron desktop target is configured but unaudited.** `electron/main.cjs`, `preload.cjs`, and `electron-builder` config ship in `package.json`. If desktop distribution is in scope, it needs its own security review (context isolation, remote content, auto-update). If not, consider removing to reduce surface. *Evidence:* `package.json` `build`/`electron` scripts.
- **P2-5 — Voice input streams audio to a third party.** `.env.example` documents that browser dictation sends the microphone to Google's speech service (guest names included). This is disclosed and toggleable (`VITE_AI_VOICE=off`), but there is no in-product consent surface. Consider an explicit consent gate before enabling voice on real guest data.

---

## Verified (checked and passed)

- **Firestore tenant isolation (rules).** Every operational collection is nested under `hotels/{hotelId}/…` and gated by `hotelStaff(hotelId)`/`hotelAdmin(hotelId)` with `hotel() == hotelId`. A catch-all `match /{document=**} { allow read, write: if false; }` denies everything unmatched. `tenantFieldOk` prevents a document's `hotelId` field from disagreeing with its path. *Evidence:* `firestore.rules` 62–175.
- **RBAC enforced server-side, not just in UI.** `server/ai/permissionGuard.ts` re-checks role and hotel on every tool call; `contextManager.ts` is the sole resolver of role/hotelId (read from `users/{uid}` via Admin SDK, never from client input). Mirrors the rules' `role()`/`hotel()`. *Evidence:* `permissionGuard.ts`, `contextManager.ts`.
- **AI cannot bypass application security.** The model never receives hotelId/role; it is server-generated. Undeclared tool args (including smuggled `hotelId`) are rejected (`strictObject`). *Evidence:* `orchestrator.ts` 200–214; Phase 5 notes; `tests/ai/tenantIsolation.test.ts`.
- **AI writes are confirmation-gated (server path) and the model never holds write authority.** Propose → store validated input in `aiPendingActions` → user confirms → `consumePendingAction` verifies (hotel+user+conversation+unexpired+unconsumed) and marks consumed **atomically in a transaction** → tool + input read from the stored action (never the request) → role re-checked at execution → executed → audited. Result sentence is built from the tool's own output, so the model cannot claim a success that did not happen. This is a textbook implementation of the boundary. *Evidence:* `orchestrator.ts` 260–449, 720–785; `confirmationManager.ts` 34–101.
- **AI collections locked down.** `aiConversations` and `aiPendingActions` are server-only (fall under the catch-all deny); `aiAuditLog` is hotel-admin-readable and client-unwritable. A client cannot mint a confirmation token. *Evidence:* `firestore.rules` 157–175; `tests/rules/ai-collections.test.ts` (referenced in Phase 5).
- **Conversation ownership + path-injection defenses.** Conversations are claimed transactionally to their first user; `conversationId` is regex-validated (`^[A-Za-z0-9_-]{1,128}$`) at the gateway and again in the conversation manager before entering any Firestore path. *Evidence:* Phase 5 notes; `aiChat.ts` 108–128, 242–249.
- **Secrets never exposed to the client.** The `VITE_` prefix boundary is documented and respected — AI key, service account, and CORS config carry no `VITE_` prefix and live only in server-side env. `admin.ts` never echoes the key. *Evidence:* `.env.example` 5–8, 39–84; `provider.ts` 1–21.
- **Provider abstraction is env-driven with honest degradation.** No hard-coded model/key/endpoint; `isProviderConfigured()` lets the gateway reply "not switched on" instead of throwing at users. *Evidence:* `provider.ts` 163–239.
- **Error handling never fabricates data.** Every failure path (tool failure, provider failure, budget exhausted, internal error) returns an honest "no answer" and preserves the audit trail; history-write failures are swallowed rather than discarding a completed turn. *Evidence:* `orchestrator.ts` 93–109, 638–650, 946–997.
- **WebMCP fails safe when unsupported.** Feature detection resolves `document.modelContext` then `navigator.modelContext`; unsupported/insecure contexts are silent no-ops; registration is idempotent per session identity; teardown via `AbortController`; auth/role/tenant re-checked at invoke time; tools reuse `src/lib` services rather than writing Firestore directly. (Write-gating is the exception — see P0-4.) *Evidence:* `src/webmcp/registry.ts` 76–224.
- **Migration is safe.** `scripts/admin/migrate.ts` defaults to dry-run, is idempotent (skips existing destination docs), never deletes/modifies legacy collections, and batches under Firestore's write cap. *Evidence:* `migrate.ts` 18–182.
- **Test suites exist and cover the security-critical paths.** `tests/ai/` (permissionGuard, toolInput, tenantIsolation, conversationAccess, promptInjection, toolSelection, auditLogging, observability, writeConfirmation, voice) + `tests/rules/` (tenant-isolation, ai-collections, pms-collections, reservations-migration) + `tests/webmcp-tools.test.ts`. `tests/rules/tenant-isolation.test.ts` was read in full and is thorough (cross-tenant read/write/delete, privilege escalation, impersonation, append-only audit log, unauthenticated access). *Evidence:* `tests/**`.

---

## Unknown / Needs verification (could not be established here)

- **Test execution.** No Node/Firebase-emulator runtime was available in this environment, so `npm run test:ai`, `test:rules`, `test:all`, `tsc -b`, and `npm run build` were **not run**. The files exist and read as sound, but a green run must be confirmed on a real machine before release. The phase notes claim 137 passing tests — plausible but unverified here.
- **Live provider behavior.** Whether the model actually selects the minimum tools and answers accurately is unverified end-to-end (no egress to the provider). This is Phase 16's job and remains open.
- **Production Vercel env.** Whether `FIREBASE_SERVICE_ACCOUNT` (full JSON), `AI_API_KEY`, and `ALLOWED_ORIGINS` (no trailing slash) are correctly set in the actual Vercel project could not be inspected — only the local `.env` was visible, and it is misconfigured (P1-2).
- **Whether the leaked key was ever committed.** `.env` is gitignored now; git history was not searchable here. Verify with `git log -p --all -S 'sk-proj' -- .env`.
- **Firebase Auth settings** (authorized domains, App Check, email-enumeration protection) are not in the repo and were not inspected.

---

## Recommended remediation order

1. **Rotate the OpenAI key now** (P0-1). Verify it's not in git history.
2. **Compile out the localStorage dev auth + `dev-mock-token`** paths for production, or `import.meta.env.DEV`-gate them (P0-2).
3. **Change role resolution to fail closed** (default `pending`/`null`, no `hotel_demo_01`); make `pending` a first-class role (P0-3).
4. **Decide WebMCP write posture** — read-only, confirmation-gated, or feature-flagged off (P0-4).
5. Fix `.env`/CORS config and add a per-account AI rate limit (P1-1, P1-2).
6. Run the full test suite + typecheck + build on a real machine; confirm green (Unknown-1).
7. Rewrite README, add Phase 16 eval set and Phase 17 docs (P1-3, P1-4).

**Do not begin new feature work until P0-1 through P0-4 are closed.**
