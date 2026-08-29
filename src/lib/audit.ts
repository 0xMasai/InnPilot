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
}

export function logAction(
  hotelId: string | null,
  action: string,
  entity: AuditEntity,
  entityId?: string | null,
  details?: string
): void {
  if (!hotelId) {
    console.error("Audit log write skipped: no hotel context");
    return;
  }
  addDoc(hotelCollection(hotelId, COLLECTIONS.AUDIT), {
    action,
    entity,
    entityId: entityId ?? null,
    details: details ?? "",
    userId: auth.currentUser?.uid ?? "unknown",
    userEmail: auth.currentUser?.email ?? "",
    at: serverTimestamp(),
  }).catch((err) => console.error("Audit log write failed:", err));
}
