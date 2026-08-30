/**
 * Confirmation Manager.
 *
 * Write tools (Phase 10) never execute on the model's say-so alone. The
 * orchestrator asks this module to create a pending action; the model tells
 * the user what it's about to do; the user confirms in a follow-up message;
 * only then does the orchestrator call `consume()` and, on success, run the
 * tool. The model cannot fabricate or skip a confirmationId — it must be
 * one this module issued for this exact hotel, tool, and input.
 *
 * Backed by hotels/{hotelId}/aiPendingActions/{id} — a new, additive
 * collection (see docs/ai/PHASE_1_PLAN.md). Written only via the Admin SDK
 * from this package; no client Firestore rules changes needed for Phase 2.
 */
import { db } from "../admin";
import { FieldValue } from "firebase-admin/firestore";

const COLLECTION = "aiPendingActions";
const EXPIRY_MS = 5 * 60 * 1000; // 5 minutes — short-lived by design.

export interface PendingAction {
  id: string;
  hotelId: string;
  userId: string;
  conversationId: string;
  toolName: string;
  input: unknown;
  summary: string;
  createdAt: FirebaseFirestore.Timestamp;
  expiresAt: FirebaseFirestore.Timestamp;
  consumedAt: FirebaseFirestore.Timestamp | null;
}

export async function createPendingAction(params: {
  hotelId: string;
  userId: string;
  conversationId: string;
  toolName: string;
  input: unknown;
  summary: string;
}): Promise<string> {
  const now = Date.now();
  const ref = db
    .collection("hotels")
    .doc(params.hotelId)
    .collection(COLLECTION)
    .doc();

  await ref.set({
    hotelId: params.hotelId,
    userId: params.userId,
    conversationId: params.conversationId,
    toolName: params.toolName,
    input: params.input,
    summary: params.summary,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: new Date(now + EXPIRY_MS),
    consumedAt: null,
  });

  return ref.id;
}

/**
 * Verifies a confirmation id belongs to this hotel/user/conversation, is
 * unexpired and unconsumed, then atomically marks it consumed. Returns the
 * pending action's tool name + input on success so the orchestrator can run
 * the tool — the caller never re-derives these from client input.
 */
export async function consumePendingAction(params: {
  hotelId: string;
  userId: string;
  conversationId: string;
  confirmationId: string;
}): Promise<{ toolName: string; input: unknown } | null> {
  const ref = db
    .collection("hotels")
    .doc(params.hotelId)
    .collection(COLLECTION)
    .doc(params.confirmationId);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;

    const data = snap.data() as Omit<PendingAction, "id">;
    const now = Date.now();

    if (
      data.userId !== params.userId ||
      data.conversationId !== params.conversationId ||
      data.consumedAt !== null ||
      data.expiresAt.toMillis() < now
    ) {
      return null;
    }

    tx.update(ref, { consumedAt: FieldValue.serverTimestamp() });
    return { toolName: data.toolName, input: data.input };
  });
}
