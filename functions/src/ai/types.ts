/**
 * Shared types for the InnPilot AI agent backend.
 *
 * `Role` is intentionally duplicated from `src/types/models.ts` rather than
 * imported: this package builds and deploys independently of the frontend.
 * Keep the two in sync — they also both need to agree with the
 * role()/hotel() logic in `firestore.rules`.
 */

import type { HotelData } from "./data/hotelData";

export type Role = "super_admin" | "hotel_admin" | "staff" | "pending";

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

/**
 * Per-turn dependencies handed to every tool handler.
 *
 * Kept separate from ToolContext on purpose: ToolContext is identity and
 * authorization (who is asking, for which hotel), while ToolDeps is the
 * request-scoped data access a handler needs. The loader is created once
 * per turn, so several tools in one turn share one Firestore read per
 * collection and none can ever see a previous request's data.
 */
export interface ToolDeps {
  data: HotelData;
  /** "Now" for this turn — injectable so date logic is testable. */
  now: Date;
}

/** A single tool's declared contract. Registered in the Tool Registry. */
export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  /** JSON Schema for `input`, as advertised to the model. */
  inputSchema: Record<string, unknown>;
  /** Roles allowed to invoke this tool. Checked by the Permission Guard. */
  allowedRoles: Role[];
  /** True for tools that change data — gated by the Confirmation Manager. */
  isWrite: boolean;
  /**
   * Parses and validates raw model-supplied input. MUST throw
   * ToolValidationError on anything unexpected rather than coercing — the
   * model's arguments are untrusted input like any other.
   */
  validateInput: (raw: unknown) => TInput;
  handler: (ctx: ToolContext, input: TInput, deps: ToolDeps) => Promise<TOutput>;
}

/**
 * A registered tool of any input/output shape.
 *
 * Registry, runner and orchestrator hold tools generically; only each tool's
 * own module knows its concrete types. `unknown` cannot express this — a
 * ToolDefinition<PeriodInput> is not assignable to ToolDefinition<unknown>,
 * because validateInput's return type is covariant. One suppressed `any`
 * here is better than the same pair repeated at every call site.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyToolDefinition = ToolDefinition<any, any>;

export interface ToolCallRecord {
  toolName: string;
  input: unknown;
  output?: unknown;
  status: "ok" | "error" | "confirmation_required" | "denied";
  errorMessage?: string;
  durationMs: number;
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
