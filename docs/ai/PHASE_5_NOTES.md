# Phase 5 — Security / Permission Guard

Two deliverables: make every tool enforce its own guarantees rather than
trusting its caller, and prove the properties with a committed test suite.

```
functions/
  src/ai/tools/
    defineTool.ts       # per-tool guard + re-validation wrapper
    sanitize.ts         # free-text neutralisation for record data
  test/
    fixtures.ts         # two-hotel fake data loader
    security.test.ts    # the six categories the brief names (48 tests)
    roles.test.ts       # role coercion + guard primitives (13 tests)
  vitest.config.mts
```

`npm test` in `functions/` runs all 61. They are pure unit tests: no
emulator, no network, no credentials, ~1s.

## Hardening

**Every tool independently enforces.** `defineReadTool()` wraps each of the
14 tools so its handler re-runs `assertCanCallTool` and re-validates its
input before doing any work. `toolRunner.ts` already does both, so this is
deliberate redundancy: a tool reached through a future orchestrator path, a
script, a test, or a refactor that forgets the runner is still safe.
Security that depends on every caller remembering to call the guard is not
security. The double check is sound because the guard is pure and every
validator is idempotent — a property the suite pins down explicitly, since
the wrapper would otherwise be free to corrupt already-validated input.

**Free text from the database is neutralised.** Guest names, expense
departments and menu categories are typed by staff and, in some flows, by
guests, and they travel straight into the model's context — the natural
prompt-injection channel. `sanitize.ts` strips control characters (which is
how injected text fakes message framing), caps each field at 120 characters,
and marks truncation so the model never sees a silently shortened value as
complete. The system prompt already tells the model to treat record text as
data; this is the half that does not depend on the model complying.
Numbers, statuses and amounts are never touched, and finite numeric values
are stringified rather than dropped — room numbers are strings in some
records and numbers in others.

**Results are allowlists, not blocklists.** Every tool picks named fields;
no result is built by spreading a raw document. `guestPhoneNumber`, `notes`,
`createdBy` and `guestId` exist in the data and reach no tool output. A test
asserts the exact key set of a reservation result, so adding a field is a
deliberate act that shows up in review.

## What the tests establish

| Category | Examples |
|---|---|
| Cross-property access | no tool schema has a hotel/property/tenant parameter; every schema sets `additionalProperties: false`; a smuggled `hotelId` is rejected at validation, not ignored; a hotel-A context never returns hotel-B records, including through aggregates |
| Privilege escalation | `pending` and `super_admin` are advertised zero tools and denied on direct call; a `role` argument in tool input changes nothing; a null `hotelId` is refused rather than defaulted; a handler called directly, bypassing the runner, still throws; every unrecognised stored role coerces to `pending` (9 cases incl. case and whitespace variants) |
| Unauthorized tools | an invented tool name returns an error and no output; only read-only tools are registered; a write tool registered as a test double is refused with `confirmation_required` and its handler never runs |
| Malicious parameters | 21 cases: unknown periods, SQL-ish strings, arrays where strings are expected, half-specified and inverted ranges, impossible calendar dates (`2026-13-45`, `2026-02-31`), non-object input, out-of-range and non-integer limits, over-long strings, an operator-object (`{$ne: null}`), a path-traversal string, a numeric date |
| Prompt injection | an ANSI escape + newline + "ignore all previous instructions" in a guest name comes back stripped of control characters, still readable as data; a 10,000-character name is capped and marked truncated; injected text in a grouping label cannot change a result's shape or totals |
| Sensitive data exposure | six reservation-facing tools expose no phone number, note contents, internal uid or guest id; the exact allowlist of reservation fields is asserted; a failed tool returns `"This tool failed to retrieve data."` with no stack, path or driver message |

## Decisions made while implementing (flagging, not asking permission for)

- **Roles mirror `firestore.rules`, not a stricter invention.** Every read
  tool allows `hotel_admin` and `staff`, because `hotelStaff()` in the rules
  already grants both read access to expenses, payments and reservations.
  Giving the AI a narrower rule than the UI would mean the assistant refusing
  data the user can see one click away, and the two authorization models
  drifting apart. If staff should not see financials, that is a change to
  `firestore.rules` first, and the tools follow.
- **`coerceRole` is now exported** so the escalation tests can address the
  exact boundary where a stored document becomes an authorization decision.
- **Tests use a fake data loader, not the emulator.** `ToolDeps` was made
  injectable in Phase 4 precisely for this; it keeps the suite fast enough to
  run on every change, and lets a test hand a tool hostile data that would be
  awkward to seed. Emulator-backed integration tests belong in Phase 15.
- **Injected text is neutralised, not removed.** A guest genuinely named in a
  hostile way, or a note containing odd characters, is still real data the
  manager may need to see. Deleting it would be its own form of fabrication.

## Validation

- `functions`: 61 tests pass; `tsc --noEmit` and `npm run build` clean;
  `npx eslint src test` clean (the two `no-control-regex` hits are
  deliberately suppressed with a comment explaining why — matching control
  characters is the point of that code).
- Root app: `tsc -b` clean; all 48 Firestore rules tests pass;
  `npm run lint` at 47 problems, unchanged from Phase 4 (all pre-existing
  app-code issues).
- Re-verified against the Firestore emulator that hardening changed no
  figures: daily report still 750,000 / 65,000 / 500,000, expenses 200,000,
  net 1,115,000, occupancy 40%, arrivals 1 / departures 1 / in-house 2, and
  room numbers survive sanitisation intact.

## Risks / outstanding issues

- **The gateway itself has no automated test.** `aiChat` rejects
  unauthenticated calls, non-string or over-long messages, and unlinked
  accounts, but testing an `onCall` handler needs the functions test harness
  — Phase 15.
- **No rate limiting or per-user budget.** An authenticated user can call the
  assistant as often as they like; each turn costs model tokens and Firestore
  reads. Worth adding before real exposure.
- Guest names and room numbers are, correctly, still returned — the tools are
  for hotel staff. "Sensitive data" here means PII beyond the operational
  question, internal identifiers, and secrets, not guest identity as such.
- Sanitisation covers fields tools actually return. Any new field added to a
  result must go through `cleanText`, and the key-set test is what forces
  that decision to be seen.
