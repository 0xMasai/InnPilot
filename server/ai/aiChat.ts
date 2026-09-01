/**
 * AI Gateway — transport-independent core.
 *
 * The one entry point a client reaches, minus any knowledge of how the
 * request arrived. `api/ai-chat.ts` is the Vercel adapter that calls this;
 * a different host (or a test) is another adapter, nothing more.
 *
 * Responsibilities, in order:
 *   1. Verify the caller's Firebase ID token. Under Cloud Functions the
 *      callable did this implicitly; off Firebase it is ours to do, and it
 *      is the one piece of authenticated context a client cannot forge.
 *   2. Validate the request shape.
 *   3. Resolve the caller's ToolContext (Context Manager) — never trust any
 *      hotelId/role the client sends.
 *   4. Require an active, hotel-linked account (Permission Guard).
 *   5. Hand off to the Orchestrator.
 *
 * Deliberately thin: no business logic, no tool logic, no prompt logic —
 * all of that lives in the modules it calls.
 */
import { getAuth } from "firebase-admin/auth";
import { adminApp } from "../admin";
import { resolveToolContext } from "./contextManager";
import { requireActiveAccount } from "./permissionGuard";
import { handleTurn } from "./orchestrator";
import { assertValidConversationId } from "./conversationManager";
import { ToolAuthorizationError } from "./types";
import type { AgentResponse } from "./types";

const MAX_MESSAGE_LENGTH = 4000;

/**
 * A failure with an HTTP status already decided, so adapters map errors by
 * reading a field rather than re-deriving status from error types.
 * `message` is safe to return to the client; nothing internal is put here.
 */
export class AiChatError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "AiChatError";
    this.status = status;
  }
}

export interface AiChatRequest {
  message: string;
  conversationId: string;
}

function validateRequest(raw: unknown): AiChatRequest {
  const body = raw as Partial<AiChatRequest> | null;
  if (!body || typeof body.message !== "string" || !body.message.trim()) {
    throw new AiChatError(400, "'message' is required.");
  }
  if (typeof body.conversationId !== "string" || !body.conversationId.trim()) {
    throw new AiChatError(400, "'conversationId' is required.");
  }
  try {
    // Refused here as well as in the Conversation Manager: this id becomes
    // part of a Firestore path, so it is checked before it reaches one.
    assertValidConversationId(body.conversationId);
  } catch {
    throw new AiChatError(
      400,
      "'conversationId' must be 1-128 characters of letters, numbers, hyphens or underscores."
    );
  }
  if (body.message.length > MAX_MESSAGE_LENGTH) {
    throw new AiChatError(400, "'message' is too long.");
  }
  return { message: body.message, conversationId: body.conversationId };
}

/**
 * @param idToken The Firebase ID token from the caller's Authorization
 *   header. Verified here — a caller cannot supply a uid directly.
 */
export async function handleAiChat(params: {
  idToken: string | null;
  body: unknown;
}): Promise<AgentResponse> {
  if (!params.idToken) {
    throw new AiChatError(401, "Sign in required.");
  }

  let uid: string;
  try {
    const decoded = await getAuth(adminApp).verifyIdToken(params.idToken);
    uid = decoded.uid;
  } catch {
    // Expired, malformed, revoked, or for another project — all the same
    // answer to the caller, and no detail that helps probe the difference.
    throw new AiChatError(401, "Sign in required.");
  }

  const { message, conversationId } = validateRequest(params.body);

  const ctx = await resolveToolContext(uid, conversationId);

  try {
    requireActiveAccount(ctx);
  } catch {
    throw new AiChatError(403, "This account is not yet linked to a hotel.");
  }

  try {
    return await handleTurn(ctx, message);
  } catch (err) {
    if (err instanceof ToolAuthorizationError) {
      throw new AiChatError(403, err.message);
    }
    throw err;
  }
}
