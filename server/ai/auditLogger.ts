/**
 * Audit Logger.
 *
 * Every tool call the agent makes is recorded — reads, refusals, proposed
 * writes and executed ones. The brief's list (timestamp, user, property,
 * conversation, tool, input, result/status, action type, confirmation
 * status, success) is what one row holds.
 *
 * ## Two destinations, on purpose
 *
 * `hotels/{hotelId}/aiAuditLog` is the complete agent trail. It is the one
 * place that answers "what did the assistant do in this hotel", and it is
 * mostly reads, which is why it is not the operational log: a hundred
 * `get_occupancy` rows would bury the handful of entries a manager
 * actually looks for.
 *
 * `hotels/{hotelId}/auditLog` — the existing append-only trail that
 * `src/AuditLog.tsx` renders — additionally receives a row when the agent
 * *changed something*, carrying `source: "ai"`. An AI-made room change
 * belongs beside the ones people made; a trail that shows only human
 * changes is not an incomplete answer to "who changed this room", it is a
 * wrong one.
 *
 * Both rows are written in one batch: either the change is recorded in
 * both places or in neither, never in one.
 *
 * ## What is not stored
 *
 * Guest names, free-text arguments, tool output content and confirmation
 * ids. See `redact.ts` for how each is handled and why. The rule is that
 * this collection can be read by anyone who can read the audit page, so it
 * holds what the agent *did*, never a copy of what it saw.
 *
 * ## Failure
 *
 * Fire-and-forget, mirroring `src/lib/audit.ts`: a logging failure becomes
 * an `ai.error` line for the operator (Phase 13) and is swallowed, because
 * an audit write that can break a manager's request is a worse problem
 * than a missing row. It is still awaited by the caller — on a serverless
 * host an unawaited promise is one that may simply never run.
 */
import { db } from "../admin";
import { FieldValue } from "firebase-admin/firestore";
import { describeResultShape, fingerprint, redactToolInput } from "./redact";
import { logInternalError, logProblem } from "./logger";
import type { AiAuditTarget, ToolContext, ToolFailureKind } from "./types";

const AI_AUDIT_COLLECTION = "aiAuditLog";
const OPERATIONAL_AUDIT_COLLECTION = "auditLog";

/**
 * How a write got the user's approval — or did not need one.
 *
 * `not_reached` is the honest answer for a write that failed before it
 * could be proposed (no such room, ambiguous guest): there was never a
 * question to answer. `pending` is a proposal the user has not yet
 * confirmed, and a row that stays `pending` forever is a change that was
 * offered and declined — worth being able to see.
 */
export type ConfirmationStatus =
  | "not_required"
  | "not_reached"
  | "pending"
  | "confirmed"
  | "rejected";

export interface AiAuditEvent {
  /**
   * `read` for a data lookup, `write` for anything that changes a record,
   * `unknown` when the model named a tool that does not exist — nothing was
   * read or written, and saying otherwise would be a guess.
   */
  actionType: "read" | "write" | "unknown";
  /**
   * null only when a confirmation id resolved to nothing, in which case
   * the server genuinely does not know which tool was meant.
   */
  toolName: string | null;
  /** Raw arguments as the model sent them; redacted before storage. */
  input: unknown;
  status: "ok" | "error" | "confirmation_required" | "denied";
  errorKind?: ToolFailureKind;
  confirmationStatus: ConfirmationStatus;
  /** Fingerprinted here, never stored — see `fingerprint()`. */
  confirmationId?: string;
  durationMs: number;
  reusedEarlierResult?: boolean;
  /** Tool output; only its shape is stored. */
  output?: unknown;
  /** What a completed write changed, from the tool's own `audit()`. */
  target?: AiAuditTarget;
}

/**
 * Record a turn's actions. Batched because a multi-tool question produces
 * several at once and each one costing its own round trip is latency the
 * user waits through.
 */
export async function recordAiActions(
  ctx: ToolContext,
  events: AiAuditEvent[]
): Promise<void> {
  if (events.length === 0) return;

  try {
    // Guaranteed by the Permission Guard before any tool runs; asserted
    // rather than assumed, since a null would silently write to
    // hotels/undefined.
    if (!ctx.hotelId) {
      logProblem("audit_no_hotel");
      return;
    }

    const hotel = db.collection("hotels").doc(ctx.hotelId);
    const aiLog = hotel.collection(AI_AUDIT_COLLECTION);
    const operationalLog = hotel.collection(OPERATIONAL_AUDIT_COLLECTION);
    const batch = db.batch();

    for (const event of events) {
      batch.set(aiLog.doc(), aiAuditRow(ctx, event));

      if (changedSomething(event)) {
        batch.set(operationalLog.doc(), operationalRow(ctx, event, event.target as AiAuditTarget));
      }
    }

    await batch.commit();
  } catch (err) {
    logInternalError("audit_write", err, { events: events.length });
  }
}

/**
 * True when this event represents a change that actually landed, which is
 * the only kind the operational trail should carry. A proposal, a refusal
 * and a no-op ("already Cleaning; nothing was written") each changed
 * nothing, and a log that lists them as changes is misleading.
 */
function changedSomething(event: AiAuditEvent): boolean {
  return (
    event.actionType === "write" &&
    event.status === "ok" &&
    event.confirmationStatus === "confirmed" &&
    event.target !== undefined &&
    (event.output as { changed?: unknown } | undefined)?.changed !== false
  );
}

function aiAuditRow(ctx: ToolContext, event: AiAuditEvent): Record<string, unknown> {
  return {
    at: FieldValue.serverTimestamp(),
    hotelId: ctx.hotelId,
    userId: ctx.userId,
    userEmail: ctx.userEmail ?? "",
    userRole: ctx.role,
    conversationId: ctx.conversationId,
    source: "ai",

    actionType: event.actionType,
    toolName: event.toolName,
    toolInput: redactToolInput(event.input),
    resultShape: describeResultShape(event.output),
    status: event.status,
    success: event.status === "ok",
    errorKind: event.errorKind ?? null,
    confirmationStatus: event.confirmationStatus,
    confirmationRef: event.confirmationId ? fingerprint(event.confirmationId) : null,
    durationMs: event.durationMs,
    reusedEarlierResult: event.reusedEarlierResult ?? false,

    // Only writes resolve a specific document; a read touched many or none.
    entity: event.target?.entity ?? null,
    entityId: event.target?.entityId ?? null,
  };
}

/**
 * The same change, in the shape `src/AuditLog.tsx` already renders.
 * `source: "ai"` is the only added field — additive, so every existing
 * reader keeps working, and the page can mark the row as the agent's.
 */
function operationalRow(
  ctx: ToolContext,
  event: AiAuditEvent,
  target: AiAuditTarget
): Record<string, unknown> {
  return {
    action: target.action,
    entity: target.entity,
    entityId: target.entityId,
    details: target.details,
    userId: ctx.userId,
    userEmail: ctx.userEmail ?? "",
    hotelId: ctx.hotelId,
    at: FieldValue.serverTimestamp(),

    source: "ai",
    conversationId: ctx.conversationId,
    toolName: event.toolName,
  };
}
