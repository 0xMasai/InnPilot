/**
 * Append-only audit trail.
 *
 * logAction() is fire-and-forget: it must never break the user's action,
 * so failures are logged to the console and swallowed. Entries are
 * immutable by security rule (no update/delete for anyone).
 */
import { addDoc, serverTimestamp } from "firebase/firestore";
import { auth } from "../../firebase";
import { COLLECTIONS } from "./collections";
import { hotelCollection } from "./hotelScope";

export type AuditEntity =
  | "booking"
  | "room"
  | "order"
  | "event"
  | "expense"
  | "user";

export interface AuditEntry {
  action: string;
  entity: AuditEntity;
  entityId: string | null;
  details: string;
  userId: string;
  userEmail: string;
  at: unknown; // Firestore server timestamp
  hotelId: string;
}

export function logAction(
  hotelId: string | null,
  action: string,
  entity: AuditEntity,
  entityId?: string | null,
  details?: string
): void {
  const user = auth.currentUser;
  if (!hotelId || !user) {
    console.error("Audit log write skipped: missing hotel or authenticated user");
    return;
  }

  addDoc(hotelCollection(hotelId, COLLECTIONS.AUDIT), {
    action,
    entity,
    entityId: entityId ?? null,
    details: details ?? "",
    userId: user.uid,
    userEmail: user.email ?? "",
    hotelId,
    at: serverTimestamp(),
  }).catch((err) => console.error("Audit log write failed:", err));
}
