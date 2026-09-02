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
 * It is also where a request gets its log scope (Phase 13): the id every
 * line of this request carries, and the one line at the end that says how
 * it went. That id goes back to the caller too — on the response and in
 * every error body — so a report of "it said it was unavailable" can be
 * matched to the logs that explain why.
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
import {
  currentRequestId,
  logInternalError,
  logRequestFinish,
  logRequestRejected,
  logRequestStart,
  noteRequestIdentity,
  withRequestLog,
} from "./logger";
import type { RejectionReason } from "./logger";

const MAX_MESSAGE_LENGTH = 4000;

const UNAVAILABLE_MESSAGE = "The assistant is unavailable right now.";

/**
 * A failure with an HTTP status already decided, so adapters map errors by
 * reading a field rather than re-deriving status from error types.
 * `message` is safe to return to the client; nothing internal is put here.
 *
 * `reason` is the operator's version of the same failure — finer-grained
 * than `message`, which is deliberately identical for failures a caller
 * should not be able to tell apart. `requestId` is picked up from the
 * ambient log scope, so a throw deep in validation carries the id without
 * every call site having to thread it.
 */
export class AiChatError extends Error {
  readonly status: number;
  readonly reason: RejectionReason;
  readonly requestId?: string;

  constructor(status: number, message: string, reason: RejectionReason) {
    super(message);
    this.name = "AiChatError";
    this.status = status;
    this.reason = reason;
    this.requestId = currentRequestId();
  }
}

export interface AiChatRequest {
  message: string;
  conversationId: string;
  /**
   * Present when the user is answering a confirmation prompt (Phase 10).
   *
   * Carrying it is not authority to do anything: it is checked against a
   * pending action bound to this hotel, user and conversation, which is
   * single-use and expires. What it identifies — the tool and its
   * arguments — is read from that stored action, never from this request,
   * so a forged or replayed id can at worst be refused.
   */
  confirmationId?: string;
}

/** Same shape the Confirmation Manager issues: a Firestore document id. */
const CONFIRMATION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function validateRequest(raw: unknown): AiChatRequest {
  const body = raw as Partial<AiChatRequest> | null;
  if (!body || typeof body.message !== "string" || !body.message.trim()) {
    throw new AiChatError(400, "'message' is required.", "invalid_request");
  }
  if (typeof body.conversationId !== "string" || !body.conversationId.trim()) {
    throw new AiChatError(400, "'conversationId' is required.", "invalid_request");
  }
  try {
    // Refused here as well as in the Conversation Manager: this id becomes
    // part of a Firestore path, so it is checked before it reaches one.
    assertValidConversationId(body.conversationId);
  } catch {
    throw new AiChatError(
      400,
      "'conversationId' must be 1-128 characters of letters, numbers, hyphens or underscores.",
      "invalid_request"
    );
  }
  if (body.message.length > MAX_MESSAGE_LENGTH) {
    throw new AiChatError(400, "'message' is too long.", "invalid_request");
  }

  // Shape-checked here for the same reason as conversationId: it becomes
  // part of a Firestore path. Whether it is a *valid* confirmation is the
  // Confirmation Manager's question, not this one's.
  let confirmationId: string | undefined;
  if (body.confirmationId !== undefined && body.confirmationId !== null) {
    if (
      typeof body.confirmationId !== "string" ||
      !CONFIRMATION_ID_PATTERN.test(body.confirmationId)
    ) {
      throw new AiChatError(400, "'confirmationId' is malformed.", "invalid_request");
    }
    confirmationId = body.confirmationId;
  }

  return { message: body.message, conversationId: body.conversationId, confirmationId };
}

/**
 * Handle one request, end to end.
 *
 * Never throws anything but `AiChatError`: an adapter's job is to map a
 * status onto a response, not to decide what an unrecognised exception
 * means. Anything unexpected is logged here — where the request id, user
 * and hotel are still in scope — and becomes a 500 with a sentence that
 * says nothing about the failure, since error text can carry hotel data.
 *
 * @param idToken The Firebase ID token from the caller's Authorization
 *   header. Verified here — a caller cannot supply a uid directly.
 */
export function handleAiChat(params: {
  idToken: string | null;
  body: unknown;
}): Promise<AgentResponse> {
  return withRequestLog(async (requestId) => {
    try {
      const response = await runRequest(params);
      return { ...response, requestId };
    } catch (err) {
      throw asChatError(err);
    } finally {
      // One finish line per request, whatever happened — a rejected
      // request is still a request, and its latency and reason are what
      // make "we are refusing a lot of these" visible.
      logRequestFinish();
    }
  });
}

/**
 * An error on its way out of the gateway, logged and given a status.
 *
 * A refusal we raised deliberately is logged at its specific reason and
 * passed through. Anything else is a bug or an outage: the real error goes
 * to the log, and the caller gets a fixed sentence.
 */
function asChatError(err: unknown): AiChatError {
  if (err instanceof AiChatError) {
    logRequestRejected({ status: err.status, reason: err.reason });
    return err;
  }
  logInternalError("gateway", err);
  const failure = new AiChatError(500, UNAVAILABLE_MESSAGE, "unexpected");
  logRequestRejected({ status: failure.status, reason: failure.reason });
  return failure;
}

async function runRequest(params: {
  idToken: string | null;
  body: unknown;
}): Promise<AgentResponse> {
  if (!params.idToken) {
    throw new AiChatError(401, "Sign in required.", "unauthenticated");
  }

  let uid: string;
  try {
    const decoded = await getAuth(adminApp).verifyIdToken(params.idToken);
    uid = decoded.uid;
  } catch {
    // Expired, malformed, revoked, or for another project — all the same
    // answer to the caller, and no detail that helps probe the difference.
    // The log records that it was a bad token rather than a missing one.
    throw new AiChatError(401, "Sign in required.", "invalid_token");
  }

  // Attributable from here on, even if the request never gets any further.
  noteRequestIdentity({ userId: uid });

  const { message, conversationId, confirmationId } = validateRequest(params.body);

  noteRequestIdentity({ conversationId });

  const ctx = await resolveToolContext(uid, conversationId);
  noteRequestIdentity({ hotelId: ctx.hotelId, role: ctx.role });

  // Logged here rather than on arrival so the line carries the whole
  // identity — the hotel and the role are what a reader filters by, and
  // they are not known until the Context Manager has run. Everything
  // refused before this point still produces `ai.request.rejected` and
  // `ai.request.finish`, so no request goes unaccounted for.
  logRequestStart({
    messageLength: message.length,
    answeringConfirmation: confirmationId !== undefined,
  });

  try {
    requireActiveAccount(ctx);
  } catch {
    throw new AiChatError(403, "This account is not yet linked to a hotel.", "no_hotel");
  }

  try {
    return await handleTurn(ctx, message, confirmationId);
  } catch (err) {
    if (err instanceof ToolAuthorizationError) {
      throw new AiChatError(403, err.message, "not_permitted");
    }
    throw err;
  }
}
