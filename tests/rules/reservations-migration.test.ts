import { readFileSync } from "node:fs";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { beforeAll, afterAll, beforeEach, describe, it } from "vitest";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";

const PROJECT_ID = "hotel-ms-reservations-test";
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

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "hotels", HOTEL_A), { name: "Hotel A" });
    await setDoc(doc(db, "hotels", HOTEL_B), { name: "Hotel B" });
    await setDoc(doc(db, "users", "staff-a"), { uid: "staff-a", role: "staff", hotelId: HOTEL_A });
    await setDoc(doc(db, "users", "staff-b"), { uid: "staff-b", role: "staff", hotelId: HOTEL_B });
  });
});

function dbAs(uid: string) {
  return testEnv.authenticatedContext(uid).firestore();
}

const reservation = (userId: string, hotelId = HOTEL_A, status = "Confirmed") => ({
  reservationId: "RSV-TEST-001",
  guestName: "Test Guest",
  roomNumber: "101",
  roomType: "Single",
  checkIn: serverTimestamp(),
  checkOut: serverTimestamp(),
  status,
  paymentStatus: "Pending",
  userId,
  hotelId,
  createdAt: serverTimestamp(),
});

describe("Reservations tenant migration", () => {
  it("staff can create a reservation in their own hotel", async () => {
    await assertSucceeds(
      setDoc(doc(dbAs("staff-a"), "hotels", HOTEL_A, "reservations", "r1"), reservation("staff-a"))
    );
  });

  it("staff cannot create a reservation under another hotel's path", async () => {
    await assertFails(
      setDoc(doc(dbAs("staff-a"), "hotels", HOTEL_B, "reservations", "r1"), reservation("staff-a", HOTEL_B))
    );
  });

  it("staff cannot impersonate another user in userId", async () => {
    await assertFails(
      setDoc(doc(dbAs("staff-a"), "hotels", HOTEL_A, "reservations", "r1"), reservation("staff-b"))
    );
  });

  it("staff cannot submit a hotelId different from the path", async () => {
    await assertFails(
      setDoc(doc(dbAs("staff-a"), "hotels", HOTEL_A, "reservations", "r1"), reservation("staff-a", HOTEL_B))
    );
  });

  it("staff cannot read another hotel's reservation", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "hotels", HOTEL_A, "reservations", "r1"), reservation("staff-a"));
    });
    await assertFails(getDoc(doc(dbAs("staff-b"), "hotels", HOTEL_A, "reservations", "r1")));
  });

  it("accepts every supported reservation status", async () => {
    const statuses = ["Confirmed", "Checked In", "Checked Out", "Cancelled", "No Show"];
    for (const [index, status] of statuses.entries()) {
      await assertSucceeds(
        setDoc(
          doc(dbAs("staff-a"), "hotels", HOTEL_A, "reservations", `r-${index}`),
          reservation("staff-a", HOTEL_A, status)
        )
      );
    }
  });

  it("rejects an unsupported reservation status", async () => {
    await assertFails(
      setDoc(
        doc(dbAs("staff-a"), "hotels", HOTEL_A, "reservations", "r1"),
        reservation("staff-a", HOTEL_A, "Definitely Not A Status")
      )
    );
  });
});
