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
 * `aiAuditLog` (Phase 12) is the deliberate exception, and the third block
 * below is what makes the exception explicit rather than accidental: the
 * hotel's admin may read it, because a trail nobody can review is not
 * oversight, and its contents are redacted at the point of writing so that
 * it can be read. Nobody may write one from a browser — an entry a client
 * could forge is not a record of what the agent did.
 *
 * Requires the Firestore emulator (see tests/README.md).
 */
import { readFileSync } from "node:fs";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
} from "firebase/firestore";

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
    await setDoc(doc(db, "hotels", HOTEL_A, "aiAuditLog", "entry-1"), {
      userId: "admin-a",
      hotelId: HOTEL_A,
      toolName: "get_occupancy",
      actionType: "read",
      status: "ok",
      source: "ai",
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

describe("aiAuditLog is readable by the hotel's admin and writable by nobody", () => {
  it("lets the hotel's admin read the agent's trail", async () => {
    await assertSucceeds(
      getDoc(doc(as("admin-a"), "hotels", HOTEL_A, "aiAuditLog", "entry-1"))
    );
  });

  // Same rule as auditLog itself: the trail is an oversight tool, and
  // staff reviewing their own recorded actions is not what it is for.
  it("denies staff at the same hotel", async () => {
    await assertFails(
      getDoc(doc(as("staff-a"), "hotels", HOTEL_A, "aiAuditLog", "entry-1"))
    );
  });

  it("denies an admin from another hotel", async () => {
    await assertFails(
      getDoc(doc(as("admin-b"), "hotels", HOTEL_A, "aiAuditLog", "entry-1"))
    );
  });

  it("denies unauthenticated access", async () => {
    await assertFails(
      getDoc(
        doc(
          testEnv.unauthenticatedContext().firestore(),
          "hotels",
          HOTEL_A,
          "aiAuditLog",
          "entry-1"
        )
      )
    );
  });

  // Unlike auditLog, not even staff may create here: every row in this
  // collection is written by the server, so one a browser could add would
  // be a fabricated account of something the agent never did.
  it("denies a client creating an entry", async () => {
    await assertFails(
      setDoc(doc(as("admin-a"), "hotels", HOTEL_A, "aiAuditLog", "forged"), {
        userId: "admin-a",
        hotelId: HOTEL_A,
        toolName: "update_room_status",
        source: "ai",
      })
    );
  });

  it("denies editing an entry", async () => {
    await assertFails(
      updateDoc(doc(as("admin-a"), "hotels", HOTEL_A, "aiAuditLog", "entry-1"), {
        status: "denied",
      })
    );
  });

  it("denies deleting an entry", async () => {
    await assertFails(
      deleteDoc(doc(as("admin-a"), "hotels", HOTEL_A, "aiAuditLog", "entry-1"))
    );
  });
});
