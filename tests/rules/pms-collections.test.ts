import { readFileSync } from "node:fs";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";

let env: RulesTestEnvironment;
const A = "hotel-a";
const B = "hotel-b";

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: "hotel-ms-pms-rules-test", firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8080 } });
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    await setDoc(doc(db, "hotels", A), { name: A });
    await setDoc(doc(db, "hotels", B), { name: B });
    await setDoc(doc(db, "users", "staff-a"), { uid: "staff-a", role: "staff", hotelId: A });
    await setDoc(doc(db, "users", "staff-b"), { uid: "staff-b", role: "staff", hotelId: B });
    await setDoc(doc(db, "hotels", A, "reservations", "r1"), { guestName: "Alice", userId: "staff-a", status: "Confirmed" });
    await setDoc(doc(db, "hotels", A, "payments", "p1"), { amount: 1000, userId: "staff-a" });
  });
});

afterAll(async () => { await env.cleanup(); });

const dbFor = (uid: string) => env.authenticatedContext(uid).firestore();

describe("PMS tenant boundary", () => {
  it("staff can read reservations in their hotel", async () => {
    await assertSucceeds(getDoc(doc(dbFor("staff-a"), "hotels", A, "reservations", "r1")));
  });
  it("staff cannot read reservations from another hotel", async () => {
    await assertFails(getDoc(doc(dbFor("staff-b"), "hotels", A, "reservations", "r1")));
  });
  it("staff cannot read payments from another hotel", async () => {
    await assertFails(getDoc(doc(dbFor("staff-b"), "hotels", A, "payments", "p1")));
  });
  it("staff cannot create PMS data under another hotel", async () => {
    await assertFails(setDoc(doc(dbFor("staff-a"), "hotels", B, "reservations", "sneaky"), { guestName: "Bad", userId: "staff-a", status: "Confirmed" }));
  });
  it("the test suite has the intended tenant fixture", () => expect(A).not.toBe(B));
});
