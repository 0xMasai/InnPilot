# Phase 13 — Error handling & observability

Phase 12 gave the hotel an account of what the assistant did. This phase
gives the operator an account of how the gateway behaved, and fixes three
places where a failure was handled worse than the brief's honesty rule
requires.

Two readers, two records, and they are not the same record:

| | `aiAuditLog` (Phase 12) | Log lines (Phase 13) |
| --- | --- | --- |
| Reader | the hotel's admin | whoever holds the deployment |
| Question | what did the assistant *do* | how did the gateway *behave* |
| Holds | tool, status, entity changed, confirmation status | latency, tokens, rounds, outcome, failure scope |
| Lives | Firestore, access-controlled, indefinitely | the host's log stream, drained, rotated |

The second row is why they cannot be one thing. An audit row sits inside
the same access control as the data it describes. A log line does not: it
is shipped to a hosting dashboard, drained to whatever aggregator someone
wires up next year, and kept long after the booking it mentions was
deleted. So the audit trail may hold `userEmail` and the changed document's
id, and a log line holds neither.

## What a line looks like

One JSON object per `console` call, because every host this can deploy to
parses a line that is valid JSON into queryable fields:

```json
{"ts":"2026-09-02T09:14:22.104Z","level":"info","event":"ai.tool.call",
 "requestId":"9f2c41a08b7d","userId":"uid-1","hotelId":"hotel-a",
 "role":"hotel_admin","conversationId":"c-m8x1-4f2a","toolName":"get_occupancy",
 "actionType":"read","status":"ok","errorKind":null,"durationMs":180,
 "reusedEarlierResult":false,"proposed":false}
```

Never `"Tool 'get_revenue' failed (412ms)"`. `event=ai.tool.call
status=error` is a filter; a sentence with values interpolated into it is a
haystack, and the difference matters at 3am.

The events:

| Event | When | Carries |
| --- | --- | --- |
| `ai.request.start` | a request that got past auth and validation | message *length*, whether it answers a confirmation |
| `ai.request.finish` | every request, always | outcome, `ok`, duration, providerMs, overheadMs, rounds, tool count, tokens, cached reads |
| `ai.request.rejected` | a refusal | status and the specific reason |
| `ai.provider.call` | each model round-trip | provider, model, round, latency, stop reason, tokens |
| `ai.provider.error` | a failed or unbuildable provider | kind, status, round, latency |
| `ai.tool.call` | each tool call | tool, action type, status, failure kind, duration, reuse |
| `ai.confirmation` | proposed / confirmed / refused / failed | phase, tool, failure kind |
| `ai.error` | an unexpected throw | scope, error name, message, stack |
| `ai.problem` | a handled problem with no exception | a named problem kind |

`ai.request.finish` is the one to build a dashboard on. `overheadMs` is
`durationMs - providerMs`: a rise in `providerMs` is the model being slow
and a rise in `overheadMs` is us being slow, and before this phase there
was no way to tell those apart.

## The request id

Generated at the gateway, carried through `AsyncLocalStorage` — the same
mechanism `requestCache` already uses, and for the same reason: threading a
logger through eleven call sites would change every signature between the
gateway and a tool handler.

It also goes back to the caller, on `AgentResponse.requestId` and in the
body of every error response, and Ask InnPilot prints it under a failed
turn as `Reference 9f2c41a08b7d`. A manager reporting "it said it was
unavailable" otherwise leaves support searching by "sometime this
afternoon". Twelve hex characters, because it gets pasted into a message
and typed into a search; it identifies a request, not a person, and grants
nothing.

## Free text appears in exactly one event

`ai.error` carries a thrown error's own message and stack, capped at 300
and 800 characters. Everything else on every other event is an identifier,
an enum, a count or a duration.

That is a deliberate exception, and the argument for it is that the
alternative is worse in both directions. An error stripped of its message
is a notification that something broke with no way to find out what — and
the status quo this replaced was `console.error("Tool 'x' failed:", err)`,
which logged strictly more, unstructured. The cap is there, and `ai.error`
is named as the event to exclude first if these logs are ever drained
somewhere less trusted than the deployment itself.

The reverse is enforced everywhere else, and tested: the user's question,
the model's arguments, tool results, guest names and the API key appear in
no line. Note that `ProviderRequestError`'s message is safe to log by
construction rather than by trust — the provider layer already reduces the
SDK's message to error type and status precisely because the SDK echoes the
request payload, and from Phase 4 that payload carries hotel data.

## Three failures that were handled badly

Observability found these; they are the part of the phase that changes
behaviour rather than adding lines.

**A history write could discard a finished turn.** `appendMessage` threw
straight through the orchestrator. A Firestore hiccup on the *last* write
of a turn — storing the assistant's reply — turned a completed answer into
a 500, and on the confirmation path it reported a write that had already
succeeded as a failure. History is context for the next question; it is not
the answer to this one, and it is not the record of what happened, which is
`aiAuditLog`. It now logs and continues, the same rule the Audit Logger
follows. `claimConversation` stays fatal: that one is an ownership check,
not a log.

**An unexpected exception mid-turn became a 500.** The user lost the
conversation and the tool calls the UI would have shown; the operator got
a stack trace with nothing tying it to the request. It now degrades to "I
have no answer for you rather than a guessed one", keeps the trail, and
logs `ai.error scope=turn`. This is the same rule the tool-failure path has
followed since Phase 4, applied to our own failures instead of Firestore's.

**The gateway leaked error types to its adapter.** `handleAiChat` now
converts everything into an `AiChatError` with a decided status, so the
Vercel adapter is pure HTTP mapping and unexpected failures are logged
where the request id, user and hotel are still in scope. `AiChatError`
gained a `reason` — `unauthenticated` vs `invalid_token`, which the caller
is deliberately not told apart ("Sign in required." for both) but the
operator is.

## Levels

`AI_LOG_LEVEL` = debug | info | warn | error | silent, default info, read
per line so it can change without a rebuild. An invalid value is reported
once and ignored rather than thrown — a typo in a log setting must not take
the assistant down.

Under Vitest the default is **silent**, so the existing suites that drive
the orchestrator do not print a few hundred lines nobody asserts on.
`tests/ai/observability.test.ts` asks for them explicitly.

## Validation

- **`tests/ai/observability.test.ts` — 28 tests**, asserting on what
  actually reached the console, parsed back from JSON. A logger that builds
  the right event and prints the wrong thing fails these and would pass a
  test of its arguments. They run end-to-end through `handleAiChat`, so a
  single request produces its real sequence of lines.
  - Accounting: one id on every line and returned to the caller; the
    identity on the start line; the totals line's tokens summed across
    rounds; per-round provider timing; per-tool status and duration; a
    reused result kept in the trail rather than tidied away; a failed call
    raised to `warn`.
  - Redaction: the question, a guest name a tool returned, the arguments
    the model sent, and the API key are each absent from everything logged.
  - Failure: a failed tool produces `ai.error` *and* an error record with
    no output for the model to repeat; a failed provider is logged with its
    round and latency and the reply is the fixed sentence; a bug in the turn
    degrades instead of throwing; a refusal is recorded as `model_refused`;
    a failed history write does not discard the reply, or turn a completed
    write into a reported failure; an unexpected gateway failure becomes a
    500 the caller can quote while the log says what broke.
  - Refusals: missing token vs forged token distinguished in the log and
    not in the reply; a malformed `conversationId` recorded without being
    echoed; an account with no hotel; and a finish line even for a request
    that was refused.
  - Confirmation: proposed, confirmed (with no model round-trip on the
    confirming half), and refused.
  - Levels: `error` drops the routine lines and keeps `ai.error`; `silent`
    says nothing; the default under a test run is silent.
- **Mutation-checked three times.** Removing the per-tool log line fails
  **7 of 28**; adding the user's message to `ai.request.start` fails
  **1 of 28** — the one test that guards that vector, each of the four
  redaction tests guarding a different one; reverting both error-handling
  changes (history writes fatal again, the catch-all rethrowing) fails
  **3 of 28**, and exactly the three about those behaviours.
- 191 tests pass across 13 files (168 in `tests/ai`). `npx tsc -b` clean,
  `npm run lint` clean on every file this phase touched, `npm run build`
  succeeds.

## Not verified

**No line has been emitted on a real deployment.** Everything here is
asserted against a captured console in Node. Whether Vercel's log viewer
parses these objects into fields as expected, and whether the volume at
`info` is tolerable in the plan's log retention, are one deploy away from
being known and were not guessed at here.

**Nothing is sampled or rate-limited.** A busy hotel at `info` writes
roughly six to ten lines per question. That is small, but there is no cap:
a pathological loop would write as fast as it ran. The lever that exists
today is `AI_LOG_LEVEL=error`.

**No alerting, no metrics backend, no tracing.** `ai.request.finish` was
shaped so that `ok:false` and the outcome enum are the two fields an alert
would be built on, but building one means choosing a destination, which is
a decision about someone else's infrastructure.

**The `stack` field is uncapped in usefulness, not in length.** It is
truncated at 800 characters, which on a deep async stack keeps the top
frames — normally the useful end — but a failure buried under many
`await`s may be cut off before its own frame.

---

PHASE COMPLETE: Phase 13 — Error handling & observability
Implemented:
- `server/ai/logger.ts`: one JSON object per line, request-scoped
  correlation id via AsyncLocalStorage, `AI_LOG_LEVEL`, and a closed
  vocabulary of events, outcomes, rejection reasons and error scopes
- Instrumented the whole path: request start/finish/rejected, each model
  round-trip with latency and tokens, each tool call with duration and
  status, each confirmation step, and every internal failure
- `ai.request.finish` splits latency into `providerMs` and `overheadMs`,
  so a slow model and a slow gateway are distinguishable
- Request id returned to the client and shown under a failed turn in Ask
  InnPilot as a reference a user can quote
- A failed conversation-history write no longer discards a completed turn
  or misreports a completed write as a failure
- An unexpected exception mid-turn degrades to an honest "no answer" that
  keeps the tool trail, instead of a 500 that loses the conversation
- `handleAiChat` now raises only `AiChatError`, with a `reason` the log
  records and the caller's message deliberately does not distinguish
- Replaced all ten ad-hoc `console.error` calls in `server/ai` and `api/`
Files created:
- server/ai/logger.ts
- tests/ai/observability.test.ts
- docs/ai/PHASE_13_NOTES.md (this document)
Files modified:
- server/ai/aiChat.ts (log scope, rejection reasons, single error type)
- server/ai/orchestrator.ts (provider/tool/confirmation instrumentation,
  `rememberMessage`, catch-all degradation, outcomes)
- server/ai/auditLogger.ts (structured failure reporting)
- server/ai/types.ts (`AgentResponse.requestId`)
- api/ai-chat.ts (`requestId` in error bodies, structured adapter logging)
- src/lib/aiClient.ts (`requestId` on responses and on `AiClientError`)
- src/pages/pms/AskInnPilot.tsx (reference shown on a failed turn)
- .env.example (`AI_LOG_LEVEL`)
Dependencies added:
- none
Database changes:
- none
Tests:
- tests/ai/observability.test.ts (28)
Validation:
- lint: clean on every file this phase touched (`npm run lint` still
  reports the repo’s pre-existing `no-explicit-any` errors in `src/`,
  none of them in a file this phase edited)
- typecheck: `npx tsc -b` clean
- build: `npm run build` succeeds
- tests: 191 passing across 13 files; rules tests not run (no JRE for the
  emulator, unchanged from Phase 12)
Risks / outstanding issues:
- No line emitted on a real deployment yet; log-viewer parsing and volume
  at `info` are unverified
- No sampling, rate limiting, alerting or metrics backend
- `ai.error` is the one event carrying free text (a thrown error's message
  and stack) and would be the first to exclude from any external drain
NEXT PHASE:
Phase 14 — Voice architecture
STATUS:
WAITING FOR APPROVAL
