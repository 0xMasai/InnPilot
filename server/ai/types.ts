/**
 * Shared types for the InnPilot AI agent backend.
 *
 * `Role` is intentionally duplicated from `src/types/models.ts` rather than
 * imported: this package builds and deploys independently of the frontend.
 * Keep the two in sync — they also both need to agree with the
 * role()/hotel() logic in `firestore.rules`.
 */

export type Role = "super_admin" | "hotel_admin" | "staff" | "pending";

/**
 * The entity kinds the existing audit trail already knows about
 * (`src/lib/audit.ts`, rendered by `src/AuditLog.tsx`). Kept identical so
 * an AI-made change appears in that page beside the ones people made,
 * rather than in a parallel vocabulary nobody's UI understands.
 */
export type AuditEntity = "booking" | "room" | "order" | "event" | "expense" | "user";

/**
 * What a write tool actually changed, described by the tool itself.
 *
 * Built from the resolved document, so `entityId` is a stable Firestore id
 * and `details` is written from identifiers (room number, reservation
 * reference) rather than from the human reference the model happened to
 * use — which may be a guest's name.
 */
export interface AiAuditTarget {
  entity: AuditEntity;
  entityId: string | null;
  /** Reads in the audit page beside "Room status changed" from the UI. */
  action: string;
  details: string;
}

/**
 * Server-derived identity + authorization context for a single AI request.
 *
 * This is built once per request by the Context Manager from the verified
 * `context.auth.uid` of a Firebase callable function — never from anything
 * the client (or the model) supplies. Every tool handler receives this and
 * must use it, not any hotelId/role a caller or the model might mention in
 * a message.
 */
export interface ToolContext {
  userId: string;
  userEmail: string | null;
  role: Role;
  /** null only for super_admin. */
  hotelId: string | null;
  conversationId: string;
}

/** A single tool's declared contract. Registered in the Tool Registry. */
export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  /** Roles allowed to invoke this tool. Checked by the Permission Guard. */
  allowedRoles: Role[];
  /**
   * JSON Schema for the tool's arguments, as shown to the model. It is
   * documentation for the model, never a security boundary: `validateInput`
   * re-checks everything server-side, because a model can send anything.
   */
  inputSchema: Record<string, unknown>;
  /** True for tools that change data — gated by the Confirmation Manager. */
  isWrite: boolean;
  validateInput: (raw: unknown) => TInput;
  handler: (ctx: ToolContext, input: TInput) => Promise<TOutput>;
  /**
   * Required on write tools, unused on reads: resolve the target and
   * describe the change in one sentence a person can approve or reject.
   *
   * Runs *before* anything is written, and must not write. It is the only
   * description of a pending action the user ever sees, so it is built
   * from freshly read data here rather than from the model's account of
   * what it intends to do. Throw `ToolValidationError` when the target
   * cannot be resolved or is ambiguous — refusing beats guessing which
   * record was meant.
   */
  summarize?: (ctx: ToolContext, input: TInput) => Promise<string>;
  /**
   * Required on write tools, unused on reads: what the completed change
   * should say in the audit trail (Phase 12).
   *
   * Derived from the tool's own output — the record it resolved and wrote —
   * so the trail names the document that changed rather than the reference
   * the model used to find it. Must not include guest names or any other
   * personal data; identifiers only.
   */
  audit?: (input: TInput, output: TOutput) => AiAuditTarget;
}

/**
 * A tool of unspecified shape, as the registry must store them.
 *
 * The registry is heterogeneous — every tool has its own input type — and
 * TypeScript has no existential type to say "some ToolDefinition". `any`
 * is the standard workaround here; `unknown` would make every concrete
 * tool unassignable, since `handler`'s input parameter is contravariant.
 * No input safety is lost by it: `validateInput` is what actually guards a
 * handler, and the Permission Guard checks the tool itself.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RegisteredTool = ToolDefinition<any, any>;

/**
 * Every way a tool call can fail to do what was asked. Closed on purpose:
 * a new failure path has to be named here before it can be recorded, which
 * is what keeps the audit trail's vocabulary stable enough to query.
 */
export type ToolFailureKind =
  | "unknown_tool"
  | "not_permitted"
  | "invalid_input"
  | "handler_failed"
  | "budget_exhausted"
  | "target_unresolved"
  | "summary_failed"
  | "not_confirmable"
  | "second_write_in_turn"
  | "confirmation_invalid";

export interface ToolCallRecord {
  toolName: string;
  input: unknown;
  output?: unknown;
  status: "ok" | "error" | "confirmation_required" | "denied";
  errorMessage?: string;
  /**
   * Why a call failed, as a fixed vocabulary rather than prose.
   *
   * `errorMessage` is written for the model to read and relay, so it
   * quotes the request back ("'Ada' matches 2 reservations: ...") and can
   * therefore carry guest names. The audit trail stores this instead: the
   * same information for an auditor, none of the personal data. See
   * `server/ai/redact.ts`.
   */
  errorKind?: ToolFailureKind;
  durationMs: number;
  /**
   * True when the model asked for a call it had already made this turn and
   * was served the earlier result instead of a repeated query. Kept in the
   * record so the UI and Phase 12's audit trail show what the model asked
   * for, not a tidied-up version of it.
   */
  reusedEarlierResult?: boolean;
}

/** Structured result returned by the Gateway to the client. */
export interface AgentResponse {
  conversationId: string;
  reply: string;
  toolCalls: ToolCallRecord[];
  /** Set when a write tool needs the user to confirm before executing. */
  pendingConfirmation?: {
    confirmationId: string;
    toolName: string;
    summary: string;
  };
}

export class ToolAuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolAuthorizationError";
  }
}

export class ToolValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolValidationError";
  }
}
