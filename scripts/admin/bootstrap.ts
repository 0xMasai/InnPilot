/**
 * One-time platform bootstrap.
 *
 * Solves the chicken-and-egg problem in firestore.rules: a super_admin
 * can only be created by an existing super_admin, and a hotel_admin can
 * only be created by a super_admin. The very first accounts have no
 * valid caller, so they must be seeded with Admin SDK privileges
 * (bypasses rules) instead of through the app.
 *
 * What it does, in order:
 *   1. Creates (or reuses) the super_admin Auth user + users/{uid} doc.
 *   2. Creates the first hotel doc under hotels/{hotelId}.
 *   3. Creates the hotel_admin Auth user + users/{uid} doc for that hotel.
 *
 * Idempotent: re-running with the same emails is safe — existing Auth
 * users/Firestore docs are detected and left alone (never overwritten),
 * so this can't accidentally clobber a real account.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json \
 *   npx tsx scripts/admin/bootstrap.ts \
 *     --super-admin-email=you@platform.com \
 *     --super-admin-password="ChangeMe123!" \
 *     --hotel-name="Kampala Grand Hotel" \
 *     --hotel-location="Kampala, Uganda" \
 *     --admin-email=admin@kampalagrand.com \
 *     --admin-password="ChangeMe123!" \
 *     --admin-name="Jane Doe"
 *
 * See scripts/admin/README.md for full setup instructions.
 */
import { adminAuth, adminDb, readArg } from "./lib/adminApp";
import { FieldValue } from "firebase-admin/firestore";

async function ensureUser(email: string, password: string, displayName?: string) {
  try {
    const existing = await adminAuth.getUserByEmail(email);
    console.log(`  ↳ Auth user already exists for ${email} (uid=${existing.uid}), reusing.`);
    return existing;
  } catch {
    const created = await adminAuth.createUser({ email, password, displayName });
    console.log(`  ↳ Created Auth user ${email} (uid=${created.uid}).`);
    return created;
  }
}

async function ensureUserDoc(
  uid: string,
  data: { name?: string; email: string; role: "super_admin" | "hotel_admin"; hotelId: string | null }
) {
  const ref = adminDb.collection("users").doc(uid);
  const snap = await ref.get();
  if (snap.exists) {
    console.log(`  ↳ users/${uid} already exists (role=${snap.data()?.role}), leaving untouched.`);
    return;
  }
  await ref.set({
    uid,
    name: data.name ?? "",
    email: data.email,
    role: data.role,
    hotelId: data.hotelId,
    createdAt: FieldValue.serverTimestamp(),
    createdBy: "bootstrap-script",
  });
  console.log(`  ↳ Created users/${uid} (role=${data.role}, hotelId=${data.hotelId ?? "null"}).`);
}

async function main() {
  const argv = process.argv.slice(2);

  const superAdminEmail = readArg("super-admin-email", argv);
  const superAdminPassword = readArg("super-admin-password", argv);
  const hotelName = readArg("hotel-name", argv);
  const hotelLocation = readArg("hotel-location", argv);
  const adminEmail = readArg("admin-email", argv);
  const adminPassword = readArg("admin-password", argv);
  const adminName = readArg("admin-name", argv);
  const existingHotelId = readArg("hotel-id", argv); // optional: attach to an already-created hotel

  if (!superAdminEmail || !superAdminPassword) {
    console.error("Missing --super-admin-email / --super-admin-password.");
    process.exit(1);
  }

  console.log("1. Super admin account");
  const superAdminUser = await ensureUser(superAdminEmail, superAdminPassword, "Super Admin");
  await ensureUserDoc(superAdminUser.uid, {
    email: superAdminEmail,
    role: "super_admin",
    hotelId: null,
  });

  let hotelId = existingHotelId;
  if (!hotelId) {
    if (!hotelName || !hotelLocation) {
      console.log(
        "\nNo --hotel-name/--hotel-location given and no --hotel-id given — stopping after super_admin creation."
      );
      console.log(
        "Sign in as the super_admin in the app and create the first hotel there, or re-run with --hotel-name/--hotel-location."
      );
      return;
    }
    console.log("\n2. First hotel");
    const hotelRef = adminDb.collection("hotels").doc();
    await hotelRef.set({
      name: hotelName,
      location: hotelLocation,
      subscription: { plan: "trial", status: "active" },
      createdAt: FieldValue.serverTimestamp(),
      createdBy: superAdminUser.uid,
    });
    hotelId = hotelRef.id;
    console.log(`  ↳ Created hotels/${hotelId} ("${hotelName}").`);
  } else {
    console.log(`\n2. Using existing hotel ${hotelId}`);
  }

  if (adminEmail && adminPassword) {
    console.log("\n3. Hotel admin account");
    const hotelAdminUser = await ensureUser(adminEmail, adminPassword, adminName);
    await ensureUserDoc(hotelAdminUser.uid, {
      name: adminName,
      email: adminEmail,
      role: "hotel_admin",
      hotelId,
    });
  } else {
    console.log("\n3. Skipped hotel admin creation (no --admin-email/--admin-password given).");
    console.log(`   Create one later from the Super Admin console for hotel ${hotelId}.`);
  }

  console.log("\nDone. Hotel ID:", hotelId);
}

main().catch((err) => {
  console.error("Bootstrap failed:", err);
  process.exit(1);
});
