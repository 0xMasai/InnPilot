# Admin scripts

One-off, privileged operator scripts that run **outside** the client app,
using the Firebase Admin SDK (never the public `apiKey`, never shipped to
the browser). They exist because two operations can't be done safely — or
at all — through the client SDK + Firestore rules:

- **Bootstrapping the first `super_admin`.** The rules require an
  existing `super_admin` to create another one — the very first account
  has no valid caller.
- **Bulk-migrating legacy single-tenant data.** Firestore rules deny
  client access to the old flat top-level collections entirely (nothing
  in the ruleset addresses them, and the catch-all at the bottom of
  `firestore.rules` denies anything unmatched), and a client-side loop
  isn't the right tool for a one-time bulk copy anyway.

Not part of the Vite build — `tsconfig.app.json` only includes `src`, so
nothing here is bundled or shipped.

## Setup

1. In the Firebase console → Project Settings → Service Accounts, generate
   a new private key. Save it locally as e.g. `serviceAccountKey.json` —
   **do not commit it** (already covered by `.gitignore`).
2. Install the two extra dev dependencies used only by these scripts:
   ```bash
   npm install -D firebase-admin tsx
   ```
3. Every command below needs the credential in the environment:
   ```bash
   export GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json
   ```

## 1. Bootstrap the first hotel + accounts

```bash
npx tsx scripts/admin/bootstrap.ts \
  --super-admin-email=you@platform.com \
  --super-admin-password="ChangeMe123!" \
  --hotel-name="Kampala Grand Hotel" \
  --hotel-location="Kampala, Uganda" \
  --admin-email=admin@kampalagrand.com \
  --admin-password="ChangeMe123!" \
  --admin-name="Jane Doe"
```

Idempotent — re-running with the same emails reuses existing Auth users
and leaves existing `users/{uid}` docs untouched rather than overwriting
them. Prints the created `hotelId` at the end; you'll need it for step 2.

If you already have a hotel doc from before this system existed, pass
`--hotel-id=<existingId>` instead of `--hotel-name`/`--hotel-location` to
attach the super_admin/hotel_admin accounts to it without creating a
second hotel.

## 2. Migrate legacy single-tenant data into that hotel

**Always dry-run first.** It writes nothing, just reports what it would do:

```bash
npx tsx scripts/admin/migrate.ts --hotel-id=<hotelId from step 1>
```

Read the output carefully — in particular the `users` section, which
shows every legacy account and what role it would be assigned. Anyone
who should become `hotel_admin` rather than `staff` needs their email
listed in `--admin-emails` on the real run:

```bash
npx tsx scripts/admin/migrate.ts --hotel-id=<hotelId> --execute \
  --admin-emails=admin@kampalagrand.com,another-admin@kampalagrand.com
```

This copies `accomodation`, `rooms`, `restaurant`, `conferenceRooms`,
`conferenceSpaces`, `expenses`, and `auditLog` from their old top-level
locations into `hotels/{hotelId}/...`, preserving document IDs, and
patches existing `users/{uid}` docs that don't yet have a valid
`role`/`hotelId` in place (users stays a top-level collection by design —
see `src/lib/hotelScope.ts`).

It is safe to re-run: any destination document that already exists is
skipped, so an interrupted run can just be re-run.

**The old top-level collections are never deleted or modified.** Verify
the app end-to-end against the migrated data first. Deleting the legacy
collections afterward is a deliberate, separate, manual step — not
something this script does for you.

## 3. Verify, then clean up

Sign in as the hotel_admin, confirm rooms/bookings/restaurant/conference/
expenses/audit all show up correctly scoped to the hotel, then create a
second test hotel and confirm it does **not** see the first hotel's data
before considering the migration done.
