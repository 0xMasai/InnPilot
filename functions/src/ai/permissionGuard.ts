/**
 * Permission Guard.
 *
 * The LLM is never trusted to enforce authorization, and it never supplies
 * hotelId/role — those come only from ContextManager. This module is the
 * one place every tool call gets checked against the ToolContext before its
 * handler runs. The checks intentionally mirror `firestore.rules`
 * (`role()`, `hotel()`, `hotelAdmin()`, `hotelStaff()`) so the two
 * authorization models can't silently drift apart.
 */
import { ToolAuthorizationError } from "./types";
import type { ToolContext, ToolDefinition } from "./types";

/** pending users have no hotel and no access to any tool. */
export function requireActiveAccount(ctx: ToolContext): void {
  if (ctx.role === "pending") {
    throw new ToolAuthorizationError(
      "This account is not yet linked to a hotel. Contact your hotel or super admin."
    );
  }
}

/** hotel_admin/staff must belong to a hotel; super_admin must not need one. */
export function requireHotelContext(ctx: ToolContext): string {
  if (ctx.role !== "super_admin" && !ctx.hotelId) {
    throw new ToolAuthorizationError("No hotel is associated with this account.");
  }
  if (!ctx.hotelId) {
    throw new ToolAuthorizationError("This tool requires a specific hotel context.");
  }
  return ctx.hotelId;
}

/**
 * Full authorization check for a single tool call. Throws
 * ToolAuthorizationError on any failure — callers should treat that as a
 * terminal "denied" result for this tool call, not retry or fall back to
 * unrestricted access.
 */
export function assertCanCallTool(ctx: ToolContext, tool: ToolDefinition): void {
  requireActiveAccount(ctx);

  if (!tool.allowedRoles.includes(ctx.role)) {
    throw new ToolAuthorizationError(
      `Role '${ctx.role}' is not permitted to use '${tool.name}'.`
    );
  }

  // Every current and planned V1 tool is hotel-scoped (see
  // docs/ai/PHASE_1_PLAN.md — no cross-property or platform-wide tools in
  // V1), so every tool call requires a resolved hotelId.
  requireHotelContext(ctx);
}
