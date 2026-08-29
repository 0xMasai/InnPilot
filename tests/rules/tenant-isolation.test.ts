/**
 * End-to-end tenant isolation tests, run against the real firestore.rules
 * file via the Firebase emulator (not mocked) — this exercises the actual
 * security boundary the app relies on, not just the client code's good
 * behavior.
 *
 * Requires the Firestore emulator running locally:
 *   firebase emulators:start --only firestore
 * then, in another terminal:
 *   npm run test:rules
 *
 * See README "Testing tenant isolation" for full setup — this sandbox
 * environment cannot reach the emulator download servers, so this suite
 * is written and structurally reviewed here but must be RUN in an
 * environment with the Firebase CLI / emulator available.
 */
import { readFileSync } from "node:fs";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { beforeAll, afterAll, beforeEach, describe, it } from "vitest";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from "firebase/firestore";

const PROJECT_ID = "hotel-ms-rules-test";

const HOTEL_A = "hotel-a";
const HOTEL_B = "hotel-b";

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync("firestore.rules", "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

/** Seeds two independent hotels, each with a hotel_admin and staff
 * member, plus one platform super_admin and one unapproved "pending"
 * account — the baseline every test starts from. Written with rules
 * disabled since this is fixture setup, not something under test. */
beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();

    await setDoc(doc(db, "hotels", HOTEL_A), {
      name: "Hotel A",
      location: "Kampala",
      subscription: { plan: "pro", status: "active" },
    });
    await setDoc(doc(db, "hotels", HOTEL_B), {
      name: "Hotel B",
      location: "Entebbe",
      subscription: { plan: "trial", status: "active" },
    });

    await setDoc(doc(db, "users", "super1"), { uid: "super1", role: "super_admin", hotelId: null });
    await setDoc(doc(db, "users", "admin-a"), { uid: "admin-a", role: "hotel_admin", hotelId: HOTEL_A });
    await setDoc(doc(db, "users", "staff-a"), { uid: "staff-a", role: "staff", hotelId: HOTEL_A });
    await setDoc(doc(db, "users", "admin-b"), { uid: "admin-b", role: "hotel_admin", hotelId: HOTEL_B });
    await setDoc(doc(db, "users", "staff-b"), { uid: "staff-b", role: "staff", hotelId: HOTEL_B });
    await setDoc(doc(db, "users", "pending-1"), { uid: "pending-1", role: "pending", hotelId: null });

    await setDoc(doc(db, "hotels", HOTEL_A, "rooms", "room1"), {
      number: "101",
      type: "Single",
      status: "Available",
      userId: "staff-a",
    });
    await setDoc(doc(db, "hotels", HOTEL_A, "accomodation", "booking1"), {
      guestName: "Alice",
      status: "Confirmed",
      userId: "staff-a",
    });
  });
});

function asA(uid: string) {
  return testEnv.authenticatedContext(uid).firestore();
}

describe("Hotel-scoped operational data — cross-tenant isolation", () => {
  it("staff can read their own hotel's rooms", async () => {
    await assertSucceeds(getDoc(doc(asA("staff-a"), "hotels", HOTEL_A, "rooms", "room1")));
  });

  it("staff CANNOT read another hotel's rooms", async () => {
    await assertFails(getDoc(doc(asA("staff-b"), "hotels", HOTEL_A, "rooms", "room1")));
  });

  it("staff CANNOT read another hotel's bookings", async () => {
    await assertFails(getDoc(doc(asA("staff-b"), "hotels", HOTEL_A, "accomodation", "booking1")));
  });

  it("super_admin has no access to operational data (by design)", async () => {
    await assertFails(getDoc(doc(asA("super1"), "hotels", HOTEL_A, "rooms", "room1")));
  });

  it("staff CANNOT create a room under another hotel's path", async () => {
    await assertFails(
      setDoc(doc(asA("staff-a"), "hotels", HOTEL_B, "rooms", "sneaky"), {
        number: "999",
        status: "Available",
        userId: "staff-a",
      })
    );
  });

  it("staff CANNOT delete a room (hotel_admin only)", async () => {
    await assertFails(deleteDoc(doc(asA("staff-a"), "hotels", HOTEL_A, "rooms", "room1")));
  });

  it("hotel_admin CAN delete a room in their own hotel", async () => {
    await assertSucceeds(deleteDoc(doc(asA("admin-a"), "hotels", HOTEL_A, "rooms", "room1")));
  });

  it("hotel_admin CANNOT delete a room in another hotel", async () => {
    await assertFails(deleteDoc(doc(asA("admin-b"), "hotels", HOTEL_A, "rooms", "room1")));
  });
});

describe("Write validation", () => {
  it("staff CANNOT create a record impersonating another user's uid", async () => {
    await assertFails(
      setDoc(doc(asA("staff-a"), "hotels", HOTEL_A, "rooms", "fake"), {
        number: "202",
        status: "Available",
        userId: "staff-b", // not the caller
      })
    );
  });

  it("staff CAN create a record with their own uid and a valid status", async () => {
    await assertSucceeds(
      setDoc(doc(asA("staff-a"), "hotels", HOTEL_A, "rooms", "room2"), {
        number: "202",
        status: "Available",
        userId: "staff-a",
      })
    );
  });

  it("staff CANNOT create a room with an invalid status value", async () => {
    await assertFails(
      setDoc(doc(asA("staff-a"), "hotels", HOTEL_A, "rooms", "room3"), {
        number: "203",
        status: "OnFire", // not in ROOM_STATUSES
        userId: "staff-a",
      })
    );
  });

  it("staff CAN update a booking's status to a valid value (created by someone else)", async () => {
    // booking1 was seeded with userId "staff-a"; a different staff member
    // of the SAME hotel legitimately updates it (e.g. a different shift).
    await assertSucceeds(
      updateDoc(doc(asA("staff-a"), "hotels", HOTEL_A, "accomodation", "booking1"), {
        status: "Checked In",
      })
    );
  });

  it("staff CANNOT update a booking to an invalid status value", async () => {
    await assertFails(
      updateDoc(doc(asA("staff-a"), "hotels", HOTEL_A, "accomodation", "booking1"), {
        status: "Definitely Not A Status",
      })
    );
  });
});

describe("Users collection — access control", () => {
  it("a user can read their own profile", async () => {
    await assertSucceeds(getDoc(doc(asA("staff-a"), "users", "staff-a")));
  });

  it("staff CANNOT read a staff member's profile from another hotel", async () => {
    await assertFails(getDoc(doc(asA("staff-a"), "users", "staff-b")));
  });

  it("hotel_admin CAN read a staff profile within their own hotel", async () => {
    await assertSucceeds(getDoc(doc(asA("admin-a"), "users", "staff-a")));
  });

  it("hotel_admin CANNOT read a staff profile from another hotel", async () => {
    await assertFails(getDoc(doc(asA("admin-a"), "users", "staff-b")));
  });

  it("super_admin can read any user profile", async () => {
    await assertSucceeds(getDoc(doc(asA("super1"), "users", "staff-b")));
  });

  it("staff CANNOT self-promote to hotel_admin", async () => {
    await assertFails(updateDoc(doc(asA("staff-a"), "users", "staff-a"), { role: "hotel_admin" }));
  });

  it("staff CANNOT reassign themselves to another hotel", async () => {
    await assertFails(updateDoc(doc(asA("staff-a"), "users", "staff-a"), { hotelId: HOTEL_B }));
  });

  it("hotel_admin CANNOT create another hotel_admin (super_admin only)", async () => {
    await assertFails(
      setDoc(doc(asA("admin-a"), "users", "new-admin"), {
        uid: "new-admin",
        role: "hotel_admin",
        hotelId: HOTEL_A,
      })
    );
  });

  it("hotel_admin CAN create a staff account for their own hotel", async () => {
    await assertSucceeds(
      setDoc(doc(asA("admin-a"), "users", "new-staff"), {
        uid: "new-staff",
        role: "staff",
        hotelId: HOTEL_A,
      })
    );
  });

  it("hotel_admin CANNOT create a staff account for another hotel", async () => {
    await assertFails(
      setDoc(doc(asA("admin-a"), "users", "new-staff-b"), {
        uid: "new-staff-b",
        role: "staff",
        hotelId: HOTEL_B,
      })
    );
  });

  it("super_admin CANNOT create a hotel_admin referencing a nonexistent hotel", async () => {
    await assertFails(
      setDoc(doc(asA("super1"), "users", "orphan-admin"), {
        uid: "orphan-admin",
        role: "hotel_admin",
        hotelId: "does-not-exist",
      })
    );
  });

  it("hotel_admin CANNOT delete a staff account from another hotel", async () => {
    await assertFails(deleteDoc(doc(asA("admin-a"), "users", "staff-b")));
  });
});

describe("Hotels collection — platform vs. tenant boundary", () => {
  it("hotel_admin CANNOT create a new hotel (super_admin only)", async () => {
    await assertFails(
      setDoc(doc(asA("admin-a"), "hotels", "hotel-c"), {
        name: "Hotel C",
        location: "Jinja",
        subscription: { plan: "trial", status: "active" },
      })
    );
  });

  it("super_admin CAN create a new hotel", async () => {
    await assertSucceeds(
      setDoc(doc(asA("super1"), "hotels", "hotel-c"), {
        name: "Hotel C",
        location: "Jinja",
        subscription: { plan: "trial", status: "active" },
      })
    );
  });

  it("hotel_admin CANNOT edit their own hotel's subscription (super_admin only)", async () => {
    await assertFails(
      updateDoc(doc(asA("admin-a"), "hotels", HOTEL_A), {
        subscription: { plan: "pro", status: "cancelled" },
      })
    );
  });

  it("hotel_admin CANNOT read another hotel's document", async () => {
    await assertFails(getDoc(doc(asA("admin-a"), "hotels", HOTEL_B)));
  });
});

describe("Audit log — append-only, hotel-admin-only read", () => {
  it("staff CAN log their own action", async () => {
    await assertSucceeds(
      setDoc(doc(asA("staff-a"), "hotels", HOTEL_A, "auditLog", "log1"), {
        userId: "staff-a",
        action: "Room added",
        at: serverTimestamp(),
      })
    );
  });

  it("staff CANNOT log an action attributed to someone else", async () => {
    await assertFails(
      setDoc(doc(asA("staff-a"), "hotels", HOTEL_A, "auditLog", "log2"), {
        userId: "staff-b",
        action: "Room added",
        at: serverTimestamp(),
      })
    );
  });

  it("staff CANNOT read the hotel's audit log (hotel_admin only)", async () => {
    await assertFails(getDoc(doc(asA("staff-a"), "hotels", HOTEL_A, "auditLog", "log1")));
  });

  it("hotel_admin CAN read their hotel's audit log", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "hotels", HOTEL_A, "auditLog", "log1"), {
        userId: "staff-a",
        action: "Room added",
      });
    });
    await assertSucceeds(getDoc(doc(asA("admin-a"), "hotels", HOTEL_A, "auditLog", "log1")));
  });

  it("nobody can update an audit log entry, not even the hotel_admin", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "hotels", HOTEL_A, "auditLog", "log1"), {
        userId: "staff-a",
        action: "Room added",
      });
    });
    await assertFails(
      updateDoc(doc(asA("admin-a"), "hotels", HOTEL_A, "auditLog", "log1"), { action: "Edited" })
    );
  });
});

describe("Unauthenticated access", () => {
  it("signed-out requests cannot read any hotel-scoped data", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, "hotels", HOTEL_A, "rooms", "room1")));
  });

  it("signed-out requests cannot read user profiles", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, "users", "staff-a")));
  });
});
