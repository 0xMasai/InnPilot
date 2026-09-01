# Phase 5 — Security and the Permission Guard

The guard from Phase 2 held up; the gaps were elsewhere. This phase found
and fixed two real ones, hardened three more surfaces, and put 72 tests
behind the boundary so a future change cannot quietly reopen them.

## Two vulnerabilities found and fixed

**1. Any user at a hotel could read a colleague's chat history.**
Conversations were addressed by a client-supplied `conversationId` with
nothing binding one to its owner. Passing someone else's id replayed their
history into your turn — a leak *inside* the tenant boundary, which
hotel-level scoping does not catch. `claimConversation` now takes ownership
transactionally on first use and refuses anyone else, with the same "not
found" message either way: whether a colleague's conversation exists is not
the caller's to learn.

**2. A conversationId could redirect the Firestore path.**
The id was concatenated into a document path unchecked, and
`collection.doc("a/messages/b")` silently addresses a *different* document
(verified against the Admin SDK — only `..` is rejected by the SDK itself).
Ids are now `^[A-Za-z0-9_-]{1,128}$`, refused at the gateway before they
reach a path and again in the Conversation Manager.

Both were introduced in Phase 2 and survived Phases 3 and 4 unnoticed.

## Hardening

- **Undeclared tool arguments are refused**, not ignored. Tools take their
  hotel from ToolContext, so a `hotelId` in tool input was already inert —
  but `strictObject` now rejects it by name. That turns a silent no-op into
  a visible error, keeps a future tool from accidentally honouring such a
  field, and gives a confused model a message it can correct itself from.
- **`optionalInt` no longer coerces.** A test caught `true` passing as a
  limit of 1 (`Number(true) === 1`); `[]` would have been 0. Only numbers
  and digit strings are accepted now. Small, but it is exactly the class of
  thing that becomes a bigger hole once write tools exist.
- **Prompt-injection rules in the system prompt.** Tool results are
  declared data, not instructions; the user's claims about their role or
  hotel carry no authority; the prompt itself is not to be revealed. These
  are defence in depth — the enforcement is in code — but they cost
  nothing and change how the model handles a poisoned record.
- **List output is bounded** (100 rooms, 100 arrivals/departures, 50
  reservations) with an explicit truncation note. Counts stay exact.
  Unbounded lists are a cost and context risk on a large property, not just
  an aesthetic one.

## What the tests assert

`tests/ai/` — 63 tests, no emulator or credentials needed (the data layer
and provider are mocked, so a scripted "misbehaving model" is possible):

| Suite | Covers |
|---|---|
| `permissionGuard.test.ts` | every role against read and admin-only tools, including `pending`, `super_admin`, and an unknown role |
| `toolInput.test.ts` | malformed values, impossible dates, reversed ranges, smuggled tenant ids, coercion traps |
| `tenantIsolation.test.ts` | every registered tool reads only `ctx.hotelId`, and refuses a supplied one |
| `conversationAccess.test.ts` | ownership, the "not found" response, path-shaped ids |
| `promptInjection.test.ts` | a poisoned guest name reaching the model as JSON data; an injected instruction failing to widen tool access; unknown tools; the round cap |

`tests/rules/ai-collections.test.ts` — 9 tests against the real
`firestore.rules` via the emulator: no client can read AI conversation
history (not the owner, not the hotel admin, not staff, not another
hotel's admin, not anonymous), and none can create, read, or consume a
pending write-action. That last one matters ahead of Phase 10: a client
that could mint a confirmation token could approve its own writes.

The prompt-injection suite deliberately asserts the *system's* behaviour,
not the model's: the poisoned name is passed through as data (redacting it
would hide real guest records), and what stops it mattering is that
authorization is re-checked in code on every call.

## The brief's checklist

| Required | Where |
|---|---|
| Cross-property access | `tenantIsolation.test.ts`, `ai-collections.test.ts` |
| Privilege escalation | `permissionGuard.test.ts`, `promptInjection.test.ts` |
| Unauthorized tools | `promptInjection.test.ts` (unknown tool, denied tool) |
| Malicious parameters | `toolInput.test.ts`, `conversationAccess.test.ts` |
| Prompt injection | `promptInjection.test.ts` |
| Sensitive data exposure | `ai-collections.test.ts`; error paths carry status and shape only, never payloads (Phases 3-4) |

## Validation

- **125 tests pass** (10 files): the 53 that existed, plus 72 new.
- `npx tsc -b` and `npx eslint server api` clean.
- Path-redirection behaviour confirmed empirically against the Admin SDK
  before fixing it, not assumed.
- New scripts: `npm run test:ai` (fast, no emulator), `npm run test:all`
  (everything, emulator started for you).

## Risks / outstanding issues

- **No rate limiting or spend cap.** Still the biggest gap, and it grows
  teeth in Phase 8 when a chat box reaches users: one authenticated account
  can spend the deployment's API budget in a loop. Worth a per-user request
  cap before that ships.
- **Guest names are returned by tools and stored in message history.** The
  same data the same users see in the app, but it means AI conversations
  now hold PII — retention and redaction are Phase 12's problem and should
  not be forgotten there.
- **A compromised service account is total.** It bypasses every rule. This
  is inherent to the Admin SDK, and the reason the guard exists at all.
- Tool results are returned to the client in `toolCalls[].output`. That is
  data the caller could already read in the app, but it is worth
  remembering if a future tool ever reads something the UI does not show.

---

PHASE COMPLETE: Phase 5 — Security / Permission Guard
Implemented:
- Conversation ownership, bound transactionally to the user who started it
- conversationId validation at the gateway and in the Conversation Manager,
  closing an uncontrolled Firestore path construction
- Strict tool arguments: undeclared keys, including smuggled tenant ids,
  are refused rather than ignored
- Non-coercing integer validation
- Prompt-injection rules in the system prompt (data-not-instructions, no
  privilege from conversation, no prompt disclosure)
- Bounded list output with explicit truncation notes
Files created:
- tests/ai/permissionGuard.test.ts, toolInput.test.ts, tenantIsolation.test.ts,
  conversationAccess.test.ts, promptInjection.test.ts
- tests/rules/ai-collections.test.ts
- docs/ai/PHASE_5_NOTES.md (this document)
Files modified:
- server/ai/conversationManager.ts (ownership, id validation)
- server/ai/aiChat.ts (id validation, 403 on ownership failure)
- server/ai/orchestrator.ts (claim before read/write, injection rules)
- server/ai/tools/validation.ts (strictObject, optionalInt)
- server/ai/tools/read/rooms.ts, frontDesk.ts (strict args, output caps)
- package.json (test:ai, test:all), tests/README.md
Dependencies added:
- none
Database changes:
- aiConversations/{id} now carries userId, hotelId, createdAt, lastMessageAt.
  Additive; existing conversations are claimed by their next user, which is
  acceptable while no production traffic exists.
Tests:
- 72 added; 125 pass in total
Validation:
- lint: clean (server + api)
- typecheck: clean (`npx tsc -b`)
- build: clean (`npm run build`)
Risks / outstanding issues:
- No rate limiting or spend cap on a billable, authenticated endpoint
- AI conversation history now holds guest PII; retention/redaction is Phase 12
- Service-account compromise bypasses every rule, by design of the Admin SDK
NEXT PHASE:
Phase 6 — Agent orchestration: selecting the minimum relevant tools per
request
STATUS:
WAITING FOR APPROVAL
