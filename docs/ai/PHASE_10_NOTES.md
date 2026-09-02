# Phase 10 — Controlled write tools

The agent can now change two things, and cannot change either of them on its
own say-so. The mechanism is the deliverable; the tools are what prove it
works.

## The rule this phase exists to enforce

> Gated by explicit, server-side-verified confirmation — never rely on the
> model alone to determine confirmation occurred.

So the model never holds the capability to write. It holds the capability to
*propose*:

```
model calls update_room_status
        ↓
orchestrator: role checked, input validated, summarize() resolves the room
        ↓
Confirmation Manager issues an id bound to hotel+user+conversation+tool+input
        ↓
response carries pendingConfirmation; NOTHING has been written
        ↓
user clicks Confirm  →  new request carrying that id
        ↓
consumePendingAction: atomic, single-use, 5-minute expiry
        ↓
tool runs, with the tool and arguments read from the stored action
```

The model is absent from everything below the fold. A model that decides
confirmation happened has changed nothing, because the only path to
`handler()` runs through an id it never sees.

## The tools

| Tool | Changes | Backed by |
| --- | --- | --- |
| `update_room_status` | One room's housekeeping status | The field `setRoomStatus()` writes from the Room Board |
| `update_reservation_status` | One booking's lifecycle status | The field `updateReservationStatus()` writes from Reservations |

Both change a single status field on a record that already exists. Neither
creates or deletes anything — Phase 11's rule, stated in the prompt and now
also asserted by a test that no registered tool's name matches
`/delete|remove|destroy|purge/`.

### What was cut, and why

The brief names `create_maintenance_task` and `create_note` as examples.
Neither was built: `maintenanceRequests` and `housekeepingTasks` have
Firestore rules and collection constants, but **nothing in InnPilot reads or
writes either one** — no service, no UI, no type, no reader anywhere in
`src/`. A tool over them would file records into a drawer no screen opens.

That is the same call Phase 2 of the WebMCP work made about folio and
payments, for the same reason: build the service first, then a tool over it.
Whoever picks up maintenance should do it in that order.

`update_reservation_status` was added in their place — a write with a real
service, a real UI, and an existing WebMCP equivalent, so the agent is doing
what the user could already do by hand.

### Only `reservations`, not `accomodation`

The legacy collection holds stays too, and the read tools combine both. It
predates the status field entirely — its records carry `isOccupied` (see
`effectiveBookingStatus()` in `src/lib/pms.ts`). Writing a status onto a
record whose shape has none is how a migration acquires a third state nobody
planned, so those stay read-only.

## Decisions worth knowing

**The summary is read, not asserted.** `summarize()` resolves the target and
reports its *current* value — "Change room 204 (Double) from 'Available' to
'Cleaning'" — because approving a change is a different decision depending
on what the record says now. The user approves the server's description of
the record, never the model's account of its intention.

**Ambiguity is refused, never resolved.** Two rooms numbered 204, or two
guests called Ada, throws instead of picking. The wrong guess checks in the
wrong person and nobody finds out. The candidates go back to the model so it
can ask.

**The target is resolved twice.** Once in `summarize()`, once in
`handler()`. Not waste — the confirmed write runs in a *later request*,
minutes may have passed, and it must act on the record as it is now. If
someone else made the change meanwhile, the no-op check catches it and
nothing is written.

**Writes never read through the request cache.** That cache exists to hold
one snapshot still for the length of a turn, which is exactly the wrong
property for a write. `listDocsUncached` / `readDocUncached` bypass it, and
the confirm path runs outside `withRequestCache` entirely.

**The confirmation turn calls no provider.** The reply — "Done — room 204 is
now 'Cleaning'" — is built by `describeWriteResult()` from the tool's own
output, and the result is read back from Firestore before it is reported. A
model asked to narrate a write it did not perform is a model that can say
"done" about a failure. It is not asked. This costs conversational polish on
that one turn, and buys the guarantee that "done" is true.

**The role is re-checked at confirmation time.** A user demoted in the five
minutes between proposing and confirming does not get the write through on
the strength of the earlier check.

**One pending action per turn.** `AgentResponse` carries a single
`pendingConfirmation`, and a user approving one button while a second change
waits unseen is the confusion confirmation exists to prevent. The first
write in the model's own order is proposed; a second in the same turn comes
back as an error telling it to ask one at a time. The claim is decided in
the synchronous `.map()`, not inside the concurrent work, or two writes in
one batch would both see "none proposed yet".

**The confirmation id never enters the model's transcript.** The tool result
the model reads carries the summary and an instruction, not the id. A value
in the transcript is a value that can be echoed back into one. A test
asserts this.

**Every way an id can fail gives one answer.** Wrong user, wrong
conversation, expired, already used, never existed — all return the same
sentence. Distinguishing them tells anyone probing ids which guess was
closest.

**A write tool with no `summarize` is inert.** The orchestrator refuses to
propose what it cannot describe, and logs it. A tool added without one fails
closed rather than silently skipping confirmation.

## The prompt needed one correction

Phase 7's write section told the model to "not perform the change
immediately" and describe it instead. Under this mechanism that is wrong:
calling the tool *is* the proposal, and a model that describes a change in
text without calling produces no pending action, so the user gets no button
and cannot approve anything. The section now says so, adds what to do when
the call returns an error instead of a summary, and states the
one-at-a-time rule.

## UI

The panel built in Phase 8 was already rendering the gateway's own
`pendingConfirmation`; its button was disabled because nothing could produce
one. It is now live: **Confirm** replays the id, **Cancel** simply never
confirms — a pending action nobody consumes expires on its own, so declining
needs no server call. A confirmed id is marked answered the moment it is
sent rather than when the reply lands, since a second click could only ever
be refused.

## Validation

- **`tests/ai/writeConfirmation.test.ts` — 21 tests**, covering: nothing is
  written when the model calls a write tool; the summary comes from stored
  data; the id stays out of the transcript; the stored input is what
  executes; confirming writes exactly once to the resolved document; the
  confirm path consults no provider; replay, forged ids, another user's id,
  another conversation's id and expiry are each refused with no write; the
  role is re-checked at confirm time; unresolvable, ambiguous and no-op
  writes are refused before anything is pending; a second write in one turn
  is refused; and the declaration invariants (both tools registered, every
  write tool has `summarize`, no tool name suggests deletion, write tools
  restricted to the roles that may write in the UI).
- **The suite was mutation-checked.** Disabling the `if (tool.isWrite)`
  branch — the single line that makes a write a proposal — fails **16 of
  the 21**. The tests fail when the property they describe is broken.
- `tests/ai/tenantIsolation.test.ts` now covers the write tools too: its
  mock gained the three write-path accessors, and each tool is exercised
  with valid arguments, so "reads only from `ctx.hotelId`" is asserted for
  `summarize()` as well as `handler()`. The `hotelId`-refusal test now
  passes each tool's own valid arguments alongside the injected `hotelId`,
  so the refusal is provably about `hotelId` and not about a missing target.
- 145 tests pass across 11 files (122 in `tests/ai`).
- `npx tsc -b` clean; `npx eslint server api tests/ai` plus the two touched
  `src/` files clean; `npm run build` succeeds.

## Not verified

**No confirmed write has ever run against real Firestore.** Every test
mocks the data layer. The paths that only real Firestore exercises — that
`updateDocFields` stamping `hotelId` alongside `status` keeps the document
editable from the browser afterwards, and that a real
`consumePendingAction` transaction refuses a concurrent double-confirm —
are unexercised. Both are worth one manual pass on the deployment before a
demo.

**The model has never been observed proposing a write.** Whether it calls
`update_room_status` rather than describing the change in prose is exactly
what the prompt correction above is aimed at, and it needs a live provider
to confirm. This is the same gap Phase 6 flagged for tool selection, and
Phase 16's evaluation set is where it gets measured.

**Audit logging is still Phase 12.** `auditLogger.ts` exists and is still
not wired. An agent-initiated write is currently indistinguishable from a
UI one in `auditLog` — which for a write tool is a more pointed gap than it
was for reads, and is the next thing worth doing.
