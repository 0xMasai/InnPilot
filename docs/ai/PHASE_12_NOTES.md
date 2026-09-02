# Phase 12 — Audit logging for AI actions

Phase 10 closed with a gap it named itself: *"an agent-initiated write is
currently indistinguishable from a UI one in `auditLog`"*. That is now
false, and the trail goes further than writes — every tool call the agent
makes is recorded before the turn returns.

## The two questions, and why they need two collections

An audit trail answers a question, and there are two different ones here.

**"Who changed this room?"** is asked in the existing Audit Log page, by an
admin looking at a record that is not what they expected. That trail must
contain AI-made changes or its answer is not incomplete, it is *wrong* —
the page would show the last human change and imply nothing else happened.

**"What has the assistant been doing?"** is asked after an incident, or
when someone wants to know what the agent read. That is mostly reads —
eight `get_occupancy` calls for every status change — and putting them in
the operational log would bury the handful of entries the first question is
about.

So:

| Collection | Holds | Read by |
| --- | --- | --- |
| `hotels/{id}/aiAuditLog` | every tool call: reads, refusals, proposals, executions | hotel admin (new rule) |
| `hotels/{id}/auditLog` | the executed changes only, with `source: "ai"` | hotel admin (unchanged) |

Both rows are written in **one batch**, so a change is recorded in both
places or in neither. `src/AuditLog.tsx` renders the mirrored row beside
the human ones with an "Ask InnPilot" badge, and a source filter separates
them.

The mirror is deliberately narrow: a *proposal* nobody confirmed, a refused
tool call and a no-op ("already Cleaning; nothing was written") each changed
nothing, and a log of changes that lists them is a log that lies. They are
all in `aiAuditLog`.

## What a row holds

The brief's list — timestamp, userId, propertyId, conversationId, toolName,
toolInput, toolResult/status, actionType, confirmationStatus,
success/failure — plus `errorKind`, `durationMs`, `reusedEarlierResult` and
`userRole`.

Two of those fields are not what they first appear.

**`confirmationStatus` has five values, not three.** `not_required` is a
read. `pending` is a proposed write the user has not answered — and a row
that stays `pending` forever is a change that was offered and declined,
which is worth being able to see. `confirmed` executed. `rejected` is a
confirmation id that was presented and refused. `not_reached` is a write
that failed before it could be proposed (no such room, ambiguous guest):
there was never a question to answer, and saying `not_required` about it
would be a different claim.

**`errorKind` exists because `errorMessage` cannot be stored.** The message
is written for the model to read and relay, so it quotes the request back —
*"'Ada' matches 2 reservations: Ada Lovelace, room 101…"*. That is a guest
name, and it is exactly the sort of thing that should not be copied into a
second collection. `ToolFailureKind` is a closed union of ten values
carrying the same information for an auditor and none of the personal data.
A new failure path has to be named there before it can be recorded.

## Redaction: an allowlist, because the failure mode of a deny-list is silent

`server/ai/redact.ts` holds three rules.

**Inputs are allowlisted by key.** Only `period`, `startDate`, `endDate`,
`date`, `window`, `limit`, `filter`, `roomNumber` and `status` are stored;
everything else keeps its key and loses its value. A tool added later with
a `guestName` argument is redacted *by default* rather than by someone
remembering to add it to a list of bad words. The notable current absence
is `reservation` — `update_reservation_status` takes a booking reference
*or* a guest name and there is no way to tell which arrived, so it is
masked, and the booking that actually changed is identified from the
resolved document instead.

The raw model input is what gets redacted, not the validated one: a trail
should show what was asked for, including the malformed and the rejected.
A model that sends `{note: "ignore previous instructions"}` has that
recorded as a key it sent, with the value masked.

**Results are stored as shape, never content.** `{rooms: "array(12)",
occupancyRatePercent: "number"}` — enough to see that a question was
answered from data and how much of it, with none of the data.

**Confirmation ids are fingerprinted.** The trail needs to link "a change
was proposed" to "that change was executed", and the id is the only thing
common to both rows. Storing it would put a live capability token into a
collection people read; a 12-character SHA-256 prefix correlates the two
rows and authorises nothing.

## Writes describe their own audit entry

`ToolDefinition` gained `audit(input, output)`, the write-side counterpart
to `summarize()`. It runs on the tool's *own output* — the record it
resolved and wrote — so the trail names the document that changed rather
than the reference the model used to find it:

```
update_room_status         → room · room-204 · "204: Available → Cleaning"
update_reservation_status  → booking · res-1 · "RSV-1043 · room 101: Confirmed → Checked In"
```

The room wording is copied from `setRoomStatus()` in
`src/lib/roomService.ts` so the AI row and the human row for the same kind
of event read identically, and only `source` separates them. The
reservation line uses the reference and room number, never `describe()`,
which carries the guest's name into the reply the user reads but must not
carry it here.

An `audit()` that throws is logged and the row is lost. It is not allowed
to turn a completed write into a reported failure: the change is done and a
logging problem cannot un-do it.

## Rules

```
match /aiAuditLog/{docId} {
  allow read: if hotelAdmin(hotelId);
  allow create, update, delete: if false;
}
```

Readable, unlike `aiConversations` and `aiPendingActions`, which stay
server-only under the catch-all denial — those hold what the manager typed
and the token that authorises a write. This one exists to be reviewed, and
its contents are redacted at the point of writing precisely so that it can
be. Writes are denied to *every* client, which is stricter than `auditLog`
(where staff may create their own entries): a row a browser could add would
be a fabricated account of something the agent never did.

## Awaited, not fired and forgotten

`recordAiActions` swallows its own failures — a logging error must not
break a manager's request, the same rule `src/lib/audit.ts` follows — but
the orchestrator **awaits** it. On a serverless host the response ends the
invocation, and an unawaited write is one that may simply never run. It
rides in the same `Promise.all` as the tool messages, so it costs one
batched write per round, not one per tool call.

## Validation

- **`tests/ai/auditLogging.test.ts` — 18 tests**, asserting at the
  Firestore boundary rather than on the logger's arguments: `written` is
  every document that reached the database, and the redaction tests search
  all of it. A logger that builds a perfect event and then stores the wrong
  thing passes the first kind of test and fails these.
  - Recorded: a successful read; one row per call in a multi-tool turn; an
    invented tool name (as `actionType: "unknown"` — nothing was read or
    written); a call the Permission Guard refused; malformed arguments; a
    reused result, kept in the trail rather than tidied away.
  - The write lifecycle: a proposal is `pending` and writes nothing to the
    operational log; confirming writes to both trails; the fingerprint
    links the two rows while the id appears in neither; a refused
    confirmation is recorded even though no tool ran; a no-op is not
    reported as a change; a write that failed before proposal is
    `not_reached`.
  - Redaction: no guest name from a result reaches storage (the fixture
    puts one in `get_room_status`'s output, so this is a test of the logger
    and not of an empty fixture); results are stored as shape; the
    free-text `reservation` argument is masked while the `status` enum
    beside it survives; the changed booking is identified by reference;
    arguments the model invented are masked.
  - The allowlist is pinned against every registered tool's schema, so
    adding a tool argument fails the suite until someone decides whether it
    may be stored.
- **The suite was mutation-checked twice.** Removing the per-turn
  `recordAiActions` call fails **13 of 18**; storing `event.input` and
  `event.output` raw instead of redacting fails **5 of 18** — the five
  redaction tests, none of the others.
- `tests/rules/ai-collections.test.ts` gained **7 tests** for the new
  collection: the hotel's admin can read it; staff, another hotel's admin
  and an unauthenticated client cannot; nobody can create, edit or delete
  an entry.
- 163 tests pass across 12 files (140 in `tests/ai`). `npx tsc -b` clean;
  `npm run build` succeeds.

## Not verified

**The rules tests did not run here** — no JRE on this machine, so the
Firestore emulator could not start (`npm run test:rules`, see
`tests/README.md`). The seven new cases are written and the rule block
mirrors `auditLog`'s, but they have not been executed against the real
rules file.

**No audit row has been written to real Firestore.** Every test uses a
stub `db`, so what a real batch does — the `FieldValue.serverTimestamp()`
sentinel, the commit itself — is unexercised, the same gap Phase 10 left
for confirmed writes. One manual pass on the deployment covers both: make a
change through Ask InnPilot, then look for it in the Audit Log page with
the "Done via Ask InnPilot" filter.

**Read volume has not been measured.** Every tool call is now a document.
A busy hotel asking the assistant a hundred questions a day writes a few
hundred rows a day into `aiAuditLog`, which is cheap, but nothing expires
them. A retention policy (TTL on `at`) is the obvious follow-up and was not
built here, because guessing a retention period for someone else's
compliance requirements is worse than leaving the decision visible.

## One pre-existing lint error, untouched

`npm run lint` reports `Unexpected any` at `src/AuditLog.tsx:116` — the
`setFilterEntity(e.target.value as any)` cast that was already there before
this phase (line 104 on `main`). The new source filter beside it is typed
properly. Fixing the old one is a one-line change in a file this phase
edits, but it is not this phase's change to make.

---

PHASE COMPLETE: Phase 12 — Audit logging
Implemented:
- Every AI tool call recorded in a new hotel-scoped `aiAuditLog`: reads,
  denials, invalid input, proposed writes, executed writes, and refused
  confirmations
- Executed changes additionally mirrored into the existing `auditLog` with
  `source: "ai"`, in the same batch, so the Audit Log page shows AI-made
  changes beside human ones
- Redaction module: input allowlist, result-shape-only storage, fingerprinted
  confirmation ids
- `ToolFailureKind` — a closed vocabulary replacing model-facing error prose
  in the trail
- `ToolDefinition.audit()` on both write tools, identifying the changed
  document without guest names
- Audit Log page: "Ask InnPilot" badge and a source filter
Files created:
- server/ai/redact.ts
- tests/ai/auditLogging.test.ts
- docs/ai/PHASE_12_NOTES.md (this document)
Files modified:
- server/ai/auditLogger.ts (rewritten around `recordAiActions`)
- server/ai/orchestrator.ts (failure kinds; audit of every call and every
  confirmation outcome)
- server/ai/types.ts (`AuditEntity`, `AiAuditTarget`, `ToolFailureKind`,
  `ToolCallRecord.errorKind`, `ToolDefinition.audit`)
- server/ai/tools/write/rooms.ts, server/ai/tools/write/reservations.ts
  (typed outputs carrying document ids; `audit()`)
- firestore.rules (`aiAuditLog` block)
- src/AuditLog.tsx (source badge + filter)
- tests/rules/ai-collections.test.ts (7 new cases)
- tests/ai/{promptInjection,toolSelection,writeConfirmation}.test.ts (mock
  the audit logger; it is exercised in its own file)
Dependencies added:
- none
Database changes:
- new collection `hotels/{hotelId}/aiAuditLog` (server-written, admin-read)
- additive fields on existing `auditLog` documents written by the agent:
  `source`, `conversationId`, `toolName`
Tests:
- tests/ai/auditLogging.test.ts (18), tests/rules/ai-collections.test.ts (+7)
Validation:
- lint: clean on server/, tests/, and the touched src file except one
  pre-existing `no-explicit-any` in src/AuditLog.tsx (see above)
- typecheck: `npx tsc -b` clean
- build: `npm run build` succeeds
- tests: 163 passing across 12 files; rules tests not run (no JRE for the
  emulator)
Risks / outstanding issues:
- No audit row has been written against real Firestore; worth one manual
  pass before a demo
- No retention policy on `aiAuditLog` — deliberately left as your decision
- Rules tests for the new collection are unexecuted here
NEXT PHASE:
Phase 13 — Error handling & observability
STATUS:
WAITING FOR APPROVAL
