/**
 * Client for the InnPilot AI gateway.
 *
 * One job: put an authenticated POST on the wire and hand back a typed
 * result. No React, no state, no prompt or tool knowledge — everything that
 * decides an answer lives server-side in `server/ai/`, and this file must
 * never grow a rule of its own.
 *
 * The ID token is fetched per call rather than cached: Firebase refreshes it
 * roughly hourly, and `getIdToken()` already returns the cached one until it
 * is close to expiry. Caching it here would only add a way to send a stale
 * token.
 */
import { auth } from "../../firebase";

/**
 * Mirrors `ToolCallRecord` in `server/ai/types.ts`, deliberately duplicated
 * rather than imported: tsconfig.app.json's `include` is `["src"]`, so the
 * browser build cannot reach the server tree. Keep the two in step — same
 * arrangement, and same reason, as `Role` in that file.
 */
export interface ToolCallRecord {
  toolName: string;
  input: unknown;
  output?: unknown;
  status: "ok" | "error" | "confirmation_required" | "denied";
  errorMessage?: string;
  durationMs: number;
  reusedEarlierResult?: boolean;
}

/** Mirrors `AgentResponse` in `server/ai/types.ts`. */
export interface AgentResponse {
  conversationId: string;
  /**
   * Identifies this request in the gateway's logs (Phase 13). Optional
   * because the type is shared with the Orchestrator's own return value,
   * which predates the id; a response off the wire always carries one.
   */
  requestId?: string;
  reply: string;
  toolCalls: ToolCallRecord[];
  pendingConfirmation?: {
    confirmationId: string;
    toolName: string;
    summary: string;
  };
}

/**
 * A failure the UI can render directly.
 *
 * `message` is always safe to show: the gateway returns a chosen sentence
 * for every status it raises deliberately, and anything unexpected comes
 * back as "The assistant is unavailable right now." rather than internals.
 */
export class AiClientError extends Error {
  /** HTTP status, or 0 when the request never reached the server. */
  readonly status: number;
  /**
   * The gateway's id for the failed request, when it got far enough to
   * have one. Shown to the user so a report of "it said it was
   * unavailable" comes with the one string that finds the logs; absent for
   * failures that never reached the server.
   */
  readonly requestId?: string;

  constructor(status: number, message: string, requestId?: string) {
    super(message);
    this.name = "AiClientError";
    this.status = status;
    this.requestId = requestId;
  }
}

/**
 * Where the gateway lives. Same-origin `/api/ai-chat` in production, since
 * the Vercel function is deployed alongside the app.
 *
 * `VITE_AI_API_BASE` overrides it for the case the default cannot serve:
 * `vite dev` does not run the functions in `api/`, so a local UI needs to
 * be pointed at a deployment (or `vercel dev`) to talk to the agent at all.
 * Setting it also means the response is cross-origin, so that origin has to
 * be listed in the gateway's own ALLOWED_ORIGINS.
 */
const ENDPOINT = `${import.meta.env.VITE_AI_API_BASE ?? ""}/api/ai-chat`;

/** Conversation ids must match the gateway's `[A-Za-z0-9_-]{1,128}`. */
export function newConversationId(): string {
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Ask the agent one question.
 *
 * @param signal Abort signal, so a component that unmounts mid-turn — or a
 *   user who navigates away — does not leave a request running and then set
 *   state on a dead component.
 */
export async function askInnPilot(params: {
  message: string;
  conversationId: string;
  /**
   * Set only when the user is approving a change the agent proposed. It is
   * the id the server issued with that proposal; the server decides what it
   * authorises, and this passes it back untouched.
   */
  confirmationId?: string;
  signal?: AbortSignal;
}): Promise<AgentResponse> {
  const user = auth.currentUser;
  if (!user) throw new AiClientError(401, "Sign in required.");

  let idToken: string;
  try {
    idToken = await user.getIdToken();
  } catch {
    throw new AiClientError(401, "Your session has expired. Sign in again.");
  }

  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        message: params.message,
        conversationId: params.conversationId,
        ...(params.confirmationId ? { confirmationId: params.confirmationId } : {}),
      }),
      signal: params.signal,
    });
  } catch (err) {
    // An AbortError is the caller's own doing — let it through untouched so
    // the caller can tell "I cancelled this" from "the network failed".
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new AiClientError(0, "Could not reach the assistant. Check your connection.");
  }

  // The error body is JSON by contract, but a proxy or a crashed function
  // can return HTML with an error status. Falling back to a generic
  // sentence keeps a stray "<!DOCTYPE html>" out of the chat transcript.
  if (!response.ok) {
    let message = "The assistant is unavailable right now.";
    let requestId: string | undefined;
    try {
      const body = (await response.json()) as { error?: unknown; requestId?: unknown };
      if (typeof body.error === "string" && body.error) message = body.error;
      if (typeof body.requestId === "string" && body.requestId) requestId = body.requestId;
    } catch {
      // Keep the fallback.
    }
    throw new AiClientError(response.status, message, requestId);
  }

  try {
    return (await response.json()) as AgentResponse;
  } catch {
    throw new AiClientError(response.status, "The assistant sent a malformed reply.");
  }
}
