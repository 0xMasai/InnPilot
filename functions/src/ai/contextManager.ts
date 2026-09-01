/**
 * Context Manager.
 *
 * Resolves a verified Firebase Auth uid into a ToolContext by reading
 * users/{uid} with the Admin SDK — the same lookup AuthProvider.tsx does
 * client-side, and the same one firestore.rules' role()/hotel() perform
 * server-side for every other write in this app. This is the ONLY place
 * role/hotelId are determined; nothing downstream re-derives or accepts
 * them from elsewhere.
 */
import { db } from "../admin";
import type { Role, ToolContext } from "./types";

const VALID_ROLES: readonly Role[] = ["super_admin", "hotel_admin", "staff", "pending"];

/**
 * Anything that is not one of the four known roles becomes "pending", which
 * has no access to any tool. A users/{uid} document carrying a role this
 * code does not recognise — a typo, a legacy value, or a field written by
 * something that should not have — must never be treated as permission.
 *
 * Exported for the Phase 5 privilege-escalation tests.
 */
export function coerceRole(value: unknown): Role {
  return VALID_ROLES.includes(value as Role) ? (value as Role) : "pending";
}

/**
 * @param uid Verified uid from `context.auth.uid` of a callable function.
 *   Callers MUST have already checked `context.auth` is non-null before
 *   calling this — this function does not re-verify authentication.
 * @param conversationId Client-supplied conversation id (just an opaque
 *   grouping key for history — carries no authorization weight).
 */
export async function resolveToolContext(
  uid: string,
  conversationId: string
): Promise<ToolContext> {
  const snap = await db.collection("users").doc(uid).get();
  const data = snap.data();

  const role = coerceRole(data?.role);
  const hotelId = role === "super_admin" ? null : ((data?.hotelId as string | undefined) ?? null);

  return {
    userId: uid,
    userEmail: (data?.email as string | undefined) ?? null,
    role,
    hotelId,
    conversationId,
  };
}
