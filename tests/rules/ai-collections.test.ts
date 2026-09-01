/**
 * The AI collections are server-only, and this proves it against the real
 * firestore.rules file rather than by inspection.
 *
 * `hotels/{hotelId}/aiConversations` and `aiPendingActions` are written
 * exclusively by the Cloud gateway through the Admin SDK, which bypasses
 * rules entirely. No rule grants a *client* access to them, so the
 * catch-all denial at the bottom of firestore.rules should refuse every
 * client request — including from the hotel's own admin.
 *
 * That matters for two reasons: chat history holds whatever a manager
 * typed, and a pending write-action is the token that authorises a change.
 * Neither should be readable or forgeable from a browser.
 *
 * Requires the Firestore emulator (see tests/README.md).
 */
import { readFileSync } from "node:fs";
import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { collection, doc, getDoc, getDocs, setDoc } from "firebase/firestore";

const PROJECT_ID = "hotel-ms-ai-rules-test";
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
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "users", "admin-a"), {
      uid: "admin-a",
      role: "hotel_admin",
      hotelId: HOTEL_A,
    });
    await setDoc(doc(db, "users", "staff-a"), {
      uid: "staff-a",
      role: "staff",
      hotelId: HOTEL_A,
    });
    await setDoc(doc(db, "users", "admin-b"), {
      uid: "admin-b",
      role: "hotel_admin",
      hotelId: HOTEL_B,
    });

    // Seed as the server would.
    await setDoc(
      doc(db, "hotels", HOTEL_A, "aiConversations", "conv-1"),
      { userId: "admin-a", hotelId: HOTEL_A }
    );
    await setDoc(
      doc(db, "hotels", HOTEL_A, "aiConversations", "conv-1", "messages", "m1"),
      { role: "user", content: "What is our revenue?" }
    );
    await setDoc(doc(db, "hotels", HOTEL_A, "aiPendingActions", "action-1"), {
      userId: "admin-a",
      toolName: "update_room_status",
      consumedAt: null,
    });
  });
});

const as = (uid: string) => testEnv.authenticatedContext(uid).firestore();

describe("aiConversations is not client-readable", () => {
  it("denies the hotel's own admin", async () => {
    await assertFails(
      getDoc(doc(as("admin-a"), "hotels", HOTEL_A, "aiConversations", "conv-1"))
    );
  });

  it("denies the conversation owner reading their own messages", async () => {
    await assertFails(
      getDocs(
        collection(
          as("admin-a"),
          "hotels",
          HOTEL_A,
          "aiConversations",
          "conv-1",
          "messages"
        )
      )
    );
  });

  it("denies staff at the same hotel", async () => {
    await assertFails(
      getDoc(doc(as("staff-a"), "hotels", HOTEL_A, "aiConversations", "conv-1"))
    );
  });

  it("denies an admin from another hotel", async () => {
    await assertFails(
      getDoc(doc(as("admin-b"), "hotels", HOTEL_A, "aiConversations", "conv-1"))
    );
  });

  it("denies unauthenticated access", async () => {
    await assertFails(
      getDoc(
        doc(
          testEnv.unauthenticatedContext().firestore(),
          "hotels",
          HOTEL_A,
          "aiConversations",
          "conv-1"
        )
      )
    );
  });

  it("denies a client writing conversation history", async () => {
    await assertFails(
      setDoc(doc(as("admin-a"), "hotels", HOTEL_A, "aiConversations", "conv-2"), {
        userId: "admin-a",
      })
    );
  });
});

describe("aiPendingActions cannot be read or forged from a client", () => {
  it("denies reading a pending action", async () => {
    await assertFails(
      getDoc(doc(as("admin-a"), "hotels", HOTEL_A, "aiPendingActions", "action-1"))
    );
  });

  // The confirmation token is what will authorise a write in Phase 10; a
  // client that could mint one could approve its own actions.
  it("denies creating a pending action", async () => {
    await assertFails(
      setDoc(doc(as("admin-a"), "hotels", HOTEL_A, "aiPendingActions", "forged"), {
        userId: "admin-a",
        toolName: "update_room_status",
        consumedAt: null,
      })
    );
  });

  it("denies marking one consumed", async () => {
    await assertFails(
      setDoc(
        doc(as("admin-a"), "hotels", HOTEL_A, "aiPendingActions", "action-1"),
        { consumedAt: new Date() },
        { merge: true }
      )
    );
  });
});
