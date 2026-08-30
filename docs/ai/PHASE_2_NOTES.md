# Phase 2 — AI Infrastructure

New `functions/` package (Firebase Cloud Functions, 2nd gen, Node 20),
scoped strictly to the AI agent per `docs/ai/PHASE_1_PLAN.md` — nothing
else moved into it.

## What exists now

```
functions/src/
  admin.ts                # shared Admin SDK app/Firestore instance
  index.ts                # exports the "aiChat" callable
  ai/
    types.ts              # ToolContext, ToolDefinition, AgentResponse, errors
    contextManager.ts      # verified uid -> {role, hotelId} via users/{uid}
    permissionGuard.ts      # mirrors firestore.rules role()/hotel() logic
    toolRegistry.ts          # name -> ToolDefinition map (empty until Phase 4)
    confirmationManager.ts    # pending write-actions (aiPendingActions)
    conversationManager.ts     # message history (aiConversations/.../messages)
    auditLogger.ts               # extends existing hotels/{hotelId}/auditLog
    orchestrator.ts                # wires the above; no LLM yet (Phase 3)
    gateway.ts                      # the "aiChat" callable itself
```

`firebase.json` now registers this as a `functions` codebase (`"ai"`),
Node 20, with a predeploy build step, plus a functions emulator port.

## Decisions made while implementing (flagging, not asking permission for)

- **No `firestore.rules` changes in this phase.** The Admin SDK (used
  throughout `functions/`) bypasses security rules entirely, so nothing
  here needed a rules change. `aiConversations` and `aiPendingActions` are
  read/written only from Cloud Functions for now. If Phase 8's chat UI
  later wants live `onSnapshot` updates (the pattern the rest of the app
  uses), rules will need to be added then — noted so it isn't forgotten.
- **Audit Logger reuses the existing `AuditEntity` union** (`booking`,
  `room`, `order`, `event`, `expense`, `user`) rather than inventing a new
  entity type, so today's `AuditLog.tsx` page renders AI-initiated entries
  without any changes. `source: "ai"` plus `toolName`/`conversationId`/
  `confirmationStatus` are additive fields. Whether to widen `AuditEntity`
  itself is left for Phase 12.
- **`functions/package.json` pins `firebase-admin@^13`**, not the `^14.3.0`
  the repo's dev scripts use — `firebase-functions@6.x`'s peer range tops
  out at `^13`. This package deploys independently of those scripts, so the
  mismatch doesn't affect anything else in the repo.
- **Orchestrator is intentionally inert.** With no provider (Phase 3) and
  no tools (Phase 4) yet, `handleTurn` always returns a plain "not
  available yet" message — consistent with the brief's "never fabricate
  data on tool failure" principle, applied here to "no capability yet"
  rather than a runtime failure.

## Validation

- `functions`: `npx tsc --noEmit` clean; `npm run build` produces
  `functions/lib/**/*.js` (git-ignored — added `functions/lib` to
  `.gitignore`).
- Root app: unaffected — no files outside `functions/`, `firebase.json`,
  and `.gitignore` were touched in this phase.
- Not done (deliberately, per scope control): deploying to a real Firebase
  project, or writing the `functions/` Vitest suite — that's Phase 15.
