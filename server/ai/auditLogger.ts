/**
 * Audit Logger.
 *
 * Extends the existing append-only hotels/{hotelId}/auditLog collection
 * (see src/lib/audit.ts) rather than creating a parallel logging
 * mechanism — same collection the AuditLog.tsx admin page already reads.
 *
 * Uses the existing AuditEntity values so today's AuditLog.tsx page renders
 * these rows without changes. `source: "ai"` plus the extra AI-specific
 * fields distinguish these from UI-initiated entries; the schema is
 * additive, so no existing reader breaks. Widening AuditEntity itself (e.g.
 * a dedicated "ai" entity) is a Phase 12 decision, not made here.
 *
 * Redaction: callers must not pass raw guest PII or secrets in `details` —
 * pass identifiers (room numbers, booking ids) instead. This module does
 * not attempt to scrub arbitrary strings for PII.
 */
import { db } from "../admin";
import { FieldValue } from "firebase-admin/firestore";
import type { AuditEntity } from "./types";

export type { AuditEntity };

export async function logAiAction(params: {
  hotelId: string;
  userId: string;
  userEmail: string | null;
  conversationId: string;
  toolName: string;
  entity: AuditEntity;
  entityId: string | null;
  action: string;
  details: string;
  confirmationStatus: "not_required" | "pending" | "confirmed";
  success: boolean;
}): Promise<void> {
  // Fire-and-forget by contract: a logging failure must never break the
  // user's action. The whole body is guarded — not just the async write —
  // because a misconfigured or absent Firestore handle would otherwise throw
  // synchronously from `db.collection(...)` before the promise is even made.
  try {
    await db
      .collection("hotels")
      .doc(params.hotelId)
      .collection("auditLog")
      .add({
        action: params.action,
        entity: params.entity,
        entityId: params.entityId,
        details: params.details,
        userId: params.userId,
        userEmail: params.userEmail ?? "",
        hotelId: params.hotelId,
        at: FieldValue.serverTimestamp(),
        // AI-specific, additive fields:
        source: "ai",
        conversationId: params.conversationId,
        toolName: params.toolName,
        confirmationStatus: params.confirmationStatus,
        success: params.success,
      });
  } catch (err) {
    // Mirrors src/lib/audit.ts: log and swallow.
    console.error("AI audit log write failed:", err);
  }
}
