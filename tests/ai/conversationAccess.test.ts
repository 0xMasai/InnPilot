/**
 * Conversation ownership and id handling.
 *
 * Two things the hotel-level tenant boundary does not cover on its own:
 *
 *   1. Colleagues share a hotel. Without an ownership check, any signed-in
 *      user could pass someone else's conversationId and have that history
 *      replayed into their own turn — a leak inside the tenant.
 *   2. The id becomes part of a Firestore path. `doc("a/messages/b")`
 *      silently addresses a different document, so an unvalidated id is
 *      uncontrolled path construction.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

interface StoredConversation {
  userId: string;
  hotelId: string;
}

/** Minimal in-memory stand-in for the documents claimConversation touches. */
const store = new Map<string, StoredConversation>();
let lastPath = "";

const docRef = (path: string) => ({
  path,
  set: (data: StoredConversation) => store.set(path, data),
  update: () => undefined,
  get: () => ({ exists: store.has(path), data: () => store.get(path) }),
});

const collectionRef = (basePath: string) => ({
  doc: (id: string) => {
    // Mirrors the real SDK: a slash in the id extends the path rather than
    // being rejected, which is exactly why the id must be validated first.
    lastPath = `${basePath}/${id}`;
    return docRef(lastPath);
  },
});

vi.mock("../../server/admin", () => ({
  adminApp: {},
  db: {
    collection: (name: string) => ({
      doc: (hotelId: string) => ({
        collection: (sub: string) => collectionRef(`${name}/${hotelId}/${sub}`),
      }),
    }),
    runTransaction: async (fn: (tx: unknown) => Promise<void>) =>
      fn({
        get: (ref: ReturnType<typeof docRef>) => ref.get(),
        set: (ref: ReturnType<typeof docRef>, data: StoredConversation) =>
          ref.set(data),
        update: () => undefined,
      }),
  },
}));

const { assertValidConversationId, claimConversation } = await import(
  "../../server/ai/conversationManager"
);
const { ToolAuthorizationError, ToolValidationError } = await import(
  "../../server/ai/types"
);

const HOTEL = "hotel-a";

beforeEach(() => {
  store.clear();
  lastPath = "";
});

describe("assertValidConversationId", () => {
  it("accepts ordinary ids", () => {
    for (const id of ["abc123", "conv-1", "a_b-C9", "x".repeat(128)]) {
      expect(() => assertValidConversationId(id)).not.toThrow();
    }
  });

  it("refuses ids that would redirect the Firestore path", () => {
    for (const id of [
      "a/messages/b",
      "../../users/victim",
      "conv/../../hotels/other",
      "..",
    ]) {
      expect(() => assertValidConversationId(id)).toThrow(ToolValidationError);
    }
  });

  it("refuses empty, oversized, and exotic ids", () => {
    for (const id of ["", " ", "x".repeat(129), "conv 1", "conv;drop", "conv\n2"]) {
      expect(() => assertValidConversationId(id)).toThrow(ToolValidationError);
    }
  });
});

describe("claimConversation", () => {
  it("binds a new conversation to the user who started it", async () => {
    await claimConversation({ hotelId: HOTEL, conversationId: "conv-1", userId: "alice" });

    expect(store.get(`hotels/${HOTEL}/aiConversations/conv-1`)?.userId).toBe("alice");
    expect(lastPath).toBe(`hotels/${HOTEL}/aiConversations/conv-1`);
  });

  it("lets the owner return to their own conversation", async () => {
    await claimConversation({ hotelId: HOTEL, conversationId: "conv-1", userId: "alice" });
    await expect(
      claimConversation({ hotelId: HOTEL, conversationId: "conv-1", userId: "alice" })
    ).resolves.toBeUndefined();
  });

  // The core of it: same hotel, same rules, different person.
  it("refuses a colleague at the same hotel", async () => {
    await claimConversation({ hotelId: HOTEL, conversationId: "conv-1", userId: "alice" });

    await expect(
      claimConversation({ hotelId: HOTEL, conversationId: "conv-1", userId: "bob" })
    ).rejects.toBeInstanceOf(ToolAuthorizationError);
  });

  it("does not reveal whether someone else's conversation exists", async () => {
    await claimConversation({ hotelId: HOTEL, conversationId: "conv-1", userId: "alice" });

    await expect(
      claimConversation({ hotelId: HOTEL, conversationId: "conv-1", userId: "bob" })
    ).rejects.toThrow(/not found/i);
  });

  it("rejects a path-shaped id before touching Firestore", async () => {
    await expect(
      claimConversation({
        hotelId: HOTEL,
        conversationId: "conv-1/messages/injected",
        userId: "alice",
      })
    ).rejects.toBeInstanceOf(ToolValidationError);

    expect(lastPath).toBe("");
    expect(store.size).toBe(0);
  });
});
