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

export type MessageRole = "user" | "assistant" | "tool";

export interface StoredMessage {
  role: MessageRole;
  content: string;
  toolName?: string;
  createdAt: FirebaseFirestore.Timestamp;
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
