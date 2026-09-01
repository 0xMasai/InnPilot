/**
 * Conversation Manager.
 *
 * Persists message history so the Orchestrator can give the model
 * short-term context (e.g. resolving "yes" to the write action it was just
 * asked to confirm) without trusting the client to replay history
 * accurately.
 *
 * Backed by hotels/{hotelId}/aiConversations/{conversationId}/messages — a
 * new, additive collection, written and read only via the Admin SDK from
 * this package for now. If Phase 8's UI later wants live-updating chat via
 * client-side onSnapshot (the pattern the rest of this app uses), add
 * matching firestore.rules read rules then — deliberately not done in
 * Phase 2, since the Gateway's callable response is sufficient for a
 * request/response chat UI.
 */
import { db } from "../admin";
import { FieldValue } from "firebase-admin/firestore";
import { ToolAuthorizationError, ToolValidationError } from "./types";

/**
 * Conversation ids come from the client, and they are used to build a
 * Firestore path. Anything outside this charset is refused rather than
 * escaped: `doc("a/messages/b")` silently addresses a *different*
 * document, so an unvalidated id is uncontrolled path construction.
 */
const CONVERSATION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export function assertValidConversationId(conversationId: string): void {
  if (!CONVERSATION_ID_PATTERN.test(conversationId)) {
    throw new ToolValidationError(
      "conversationId must be 1-128 characters of letters, numbers, hyphens or underscores."
    );
  }
}

export type MessageRole = "user" | "assistant" | "tool";

export interface StoredMessage {
  role: MessageRole;
  content: string;
  toolName?: string;
  createdAt: FirebaseFirestore.Timestamp;
}

function conversationRef(hotelId: string, conversationId: string) {
  return db
    .collection("hotels")
    .doc(hotelId)
    .collection("aiConversations")
    .doc(conversationId);
}

/**
 * Bind a conversation to the user who started it, and refuse anyone else.
 *
 * Without this, any signed-in user at a hotel could pass a colleague's
 * conversationId and have that history replayed into their own turn — a
 * leak inside the tenant boundary, which hotel-level scoping alone does
 * not catch. The claim is transactional so two simultaneous first turns
 * cannot both take ownership.
 *
 * Call this before reading or appending anything for a conversation.
 */
export async function claimConversation(params: {
  hotelId: string;
  conversationId: string;
  userId: string;
}): Promise<void> {
  assertValidConversationId(params.conversationId);
  const ref = conversationRef(params.hotelId, params.conversationId);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);

    if (!snap.exists) {
      tx.set(ref, {
        userId: params.userId,
        hotelId: params.hotelId,
        createdAt: FieldValue.serverTimestamp(),
        lastMessageAt: FieldValue.serverTimestamp(),
      });
      return;
    }

    if (snap.data()?.userId !== params.userId) {
      // Same message the caller would get for a conversation that does not
      // exist: whether someone else's id is real is not theirs to learn.
      throw new ToolAuthorizationError("Conversation not found.");
    }

    tx.update(ref, { lastMessageAt: FieldValue.serverTimestamp() });
  });
}

function messagesRef(hotelId: string, conversationId: string) {
  return db
    .collection("hotels")
    .doc(hotelId)
    .collection("aiConversations")
    .doc(conversationId)
    .collection("messages");
}

export async function appendMessage(params: {
  hotelId: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  toolName?: string;
}): Promise<void> {
  await messagesRef(params.hotelId, params.conversationId).add({
    role: params.role,
    content: params.content,
    toolName: params.toolName ?? null,
    createdAt: FieldValue.serverTimestamp(),
  });
}

export async function getRecentMessages(
  hotelId: string,
  conversationId: string,
  limit = 20
): Promise<StoredMessage[]> {
  const snap = await messagesRef(hotelId, conversationId)
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();

  return snap.docs.map((d) => d.data() as StoredMessage).reverse();
}
