/**
 * Migrates pre-multi-tenant Firestore data into the hotels/{hotelId}/...
 * tenant structure (see src/lib/hotelScope.ts).
 *
 * Source shape (old, flat, single-tenant): top-level collections
 * `accomodation`, `rooms`, `restaurant`, `conferenceRooms`,
 * `conferenceSpaces`, `expenses`, `auditLog` — all unscoped, all
 * belonging implicitly to "the one hotel" the app used to assume.
 *
 * Target shape (new, multi-tenant): the same documents, same IDs, under
 * hotels/{hotelId}/{collection}/{docId}.
 *
 * `users/{uid}` is a special case: it stays top-level in both models
 * (see AuthProvider.tsx), so it is never copied — instead, any existing
 * user doc that doesn't yet have a valid role+hotelId is PATCHED in
 * place to attach it to the target hotel.
 *
 * SAFETY:
 *   - Defaults to a dry run (reports what it would do, writes nothing).
 *     Pass --execute to actually write.
 *   - Idempotent: re-running (dry or real) after a partial run skips
 *     any destination doc that already exists, so it's safe to re-run
 *     after a failure without creating duplicates.
 *   - Never deletes or modifies the legacy top-level collections
 *     (accomodation/rooms/etc). Those stay in place, untouched, as a
 *     backup — the app's Firestore rules already deny all client access
 *     to unmatched top-level paths, so leaving them doesn't reopen the
 *     old single-tenant surface. Delete them yourself, manually, only
 *     once you've verified the migrated data in the app.
 *
 * Usage (dry run first, always):
 *   GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json \
 *   npx tsx scripts/admin/migrate.ts --hotel-id=<hotelId>
 *
 * Then, once the report looks right:
 *   GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json \
 *   npx tsx scripts/admin/migrate.ts --hotel-id=<hotelId> --execute \
 *     --admin-emails=admin@kampalagrand.com
 *
 * --admin-emails: comma-separated emails of legacy user docs that should
 * become hotel_admin (matched against the doc's stored `email` field).
 * Every other legacy user doc without a valid role/hotelId becomes
 * "staff" for the target hotel. Docs that already have a valid
 * role + hotelId are left untouched (assumed already migrated/bootstrapped).
 */
import { adminDb, readArg, requireFlag } from "./lib/adminApp";
import { FieldValue } from "firebase-admin/firestore";

const LEGACY_COLLECTIONS = [
  "accomodation", // misspelling intentional — matches legacy docs (see src/lib/collections.ts)
  "rooms",
  "restaurant",
  "conferenceRooms",
  "conferenceSpaces",
  "expenses",
  "auditLog",
] as const;

const VALID_ROLES = new Set(["super_admin", "hotel_admin", "staff"]);
const BATCH_LIMIT = 400; // stay under Firestore's 500-write batch cap

async function migrateCollection(name: string, hotelId: string, execute: boolean) {
  const sourceSnap = await adminDb.collection(name).get();
  if (sourceSnap.empty) {
    console.log(`  ${name}: 0 documents — nothing to do.`);
    return { total: 0, copied: 0, skipped: 0 };
  }

  const destCollection = adminDb.collection("hotels").doc(hotelId).collection(name);
  let copied = 0;
  let skipped = 0;
  let batch = adminDb.batch();
  let opsInBatch = 0;

  for (const docSnap of sourceSnap.docs) {
    const destRef = destCollection.doc(docSnap.id);
    const destSnap = execute ? await destRef.get() : null;
    if (execute && destSnap?.exists) {
      skipped++;
      continue;
    }

    if (execute) {
      batch.set(destRef, {
        ...docSnap.data(),
        migratedFrom: `${name}/${docSnap.id}`,
        migratedAt: FieldValue.serverTimestamp(),
      });
      opsInBatch++;
      if (opsInBatch >= BATCH_LIMIT) {
        await batch.commit();
        batch = adminDb.batch();
        opsInBatch = 0;
      }
    }
    copied++;
  }

  if (execute && opsInBatch > 0) {
    await batch.commit();
  }

  console.log(
    `  ${name}: ${sourceSnap.size} found, ${copied} ${execute ? "copied" : "would copy"}${
      skipped ? `, ${skipped} skipped (already migrated)` : ""
    }.`
  );
  return { total: sourceSnap.size, copied, skipped };
}

async function migrateUsers(hotelId: string, adminEmails: Set<string>, execute: boolean) {
  const snap = await adminDb.collection("users").get();
  let patched = 0;
  let untouched = 0;

  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    const hasValidRole = typeof data.role === "string" && VALID_ROLES.has(data.role);
    const hasHotelId = typeof data.hotelId === "string" && data.hotelId.length > 0;

    if (hasValidRole && (data.role === "super_admin" || hasHotelId)) {
      untouched++;
      continue;
    }

    const role = adminEmails.has((data.email ?? "").toLowerCase()) ? "hotel_admin" : "staff";
    console.log(
      `  users/${docSnap.id} (${data.email ?? "no email"}): ${execute ? "patching" : "would patch"} → role=${role}, hotelId=${hotelId}`
    );
    if (execute) {
      await docSnap.ref.update({ role, hotelId });
    }
    patched++;
  }

  console.log(`  users: ${snap.size} found, ${patched} ${execute ? "patched" : "would patch"}, ${untouched} already valid.`);
}

async function main() {
  const argv = process.argv.slice(2);
  const hotelId = readArg("hotel-id", argv);
  const execute = requireFlag("--execute", argv);
  const adminEmails = new Set(
    (readArg("admin-emails", argv) ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  );

  if (!hotelId) {
    console.error("Missing --hotel-id=<id>. Run scripts/admin/bootstrap.ts first if you don't have one yet.");
    process.exit(1);
  }

  const hotelSnap = await adminDb.collection("hotels").doc(hotelId).get();
  if (!hotelSnap.exists) {
    console.error(`hotels/${hotelId} does not exist. Create it first (bootstrap.ts) before migrating data into it.`);
    process.exit(1);
  }

  console.log(`${execute ? "EXECUTING" : "DRY RUN"} — migrating legacy data into hotels/${hotelId} (${hotelSnap.data()?.name})\n`);

  console.log("Operational collections:");
  for (const name of LEGACY_COLLECTIONS) {
    await migrateCollection(name, hotelId, execute);
  }

  console.log("\nUser accounts:");
  await migrateUsers(hotelId, adminEmails, execute);

  if (!execute) {
    console.log("\nThis was a dry run — nothing was written. Re-run with --execute to apply.");
  } else {
    console.log("\nMigration complete. Legacy top-level collections were left in place, untouched.");
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
