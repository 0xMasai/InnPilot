# Tenant isolation tests

`tests/rules/tenant-isolation.test.ts` exercises the real
`firestore.rules` file against the Firestore emulator (not a mock) —
it asserts things like "staff at Hotel A cannot read Hotel B's
bookings" as actual denied/allowed requests, across rooms, bookings,
restaurant, expenses, conference, audit log, users, and hotels.

## Run it

One-time: the Firestore emulator needs a JRE available on your machine
(the emulator itself is a Java process). Then:

```bash
# terminal 1 — start the emulator
npx firebase emulators:start --only firestore

# terminal 2 — run the tests
npm run test:rules
```

`npm run test:rules:watch` re-runs on file changes if you're iterating
on the rules themselves.

## What's covered

- **Cross-tenant isolation**: staff/hotel_admin of one hotel cannot
  read, write, or delete another hotel's rooms, bookings, restaurant
  orders, expenses, conference bookings/spaces, or audit log.
- **Role boundaries**: staff cannot delete records (hotel_admin only);
  hotel_admin cannot create hotels or other hotel_admins (super_admin
  only); nobody can self-promote or reassign their own hotel.
- **super_admin has no operational access** — confirms the
  "keeps blast radius small" design in firestore.rules is actually
  enforced, not just documented.
- **Write validation**: can't impersonate another user's uid on
  create, can't write an invalid status value.
- **Audit log**: append-only (no update/delete by anyone), staff can
  log their own actions but not read the log back, hotel_admin can
  read but not edit.
- **Unauthenticated access** is denied everywhere.

## Adding a case

New rule → new test, same file (or a new one under `tests/rules/` if it
covers a genuinely separate concern). Each `it()` should assert exactly
one allow/deny outcome — that's what makes a failure point straight at
the rule that broke, instead of requiring someone to puzzle through a
multi-assertion test.

## AI agent tests

`tests/ai/` covers the AI layer's security boundary. No emulator or
credentials needed — the data layer and provider are mocked, so these run
anywhere:

```bash
npm run test:ai
```

- `permissionGuard.test.ts` — the role matrix, mirroring firestore.rules
- `toolInput.test.ts` — validation, and undeclared arguments (a smuggled
  `hotelId`) being refused
- `tenantIsolation.test.ts` — every tool reads only `ctx.hotelId`
- `conversationAccess.test.ts` — conversations are owned by one user, and
  ids cannot redirect a Firestore path
- `promptInjection.test.ts` — instructions planted in hotel data arrive as
  data, and cannot widen what the model may call

`tests/rules/ai-collections.test.ts` needs the emulator like the other
rules tests: it asserts no client can read AI conversation history or forge
a pending write-action.

Everything at once, with the emulator started for you:

```bash
npm run test:all
```
