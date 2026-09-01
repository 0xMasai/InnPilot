/**
 * AI Gateway.
 *
 * The one entry point a client calls. Responsibilities, in order:
 *   1. Reject unauthenticated calls (Firebase verifies `context.auth`
 *      itself before this code runs — we just check it's present).
 *   2. Validate the request shape.
 *   3. Resolve the caller's ToolContext (Context Manager) — never trust
 *      any hotelId/role the client sends.
 *   4. Require an active, hotel-linked account (Permission Guard).
 *   5. Hand off to the Orchestrator.
 *
 * Deliberately thin: no business logic, no tool logic, no prompt logic —
 * all of that lives in the modules it calls.
 */
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { AI_API_KEY } from "./config";
import { resolveToolContext } from "./contextManager";
import { requireActiveAccount } from "./permissionGuard";
import { handleTurn } from "./orchestrator";

interface AiChatRequest {
  message: string;
  conversationId: string;
}

function validateRequest(raw: unknown): AiChatRequest {
  const body = raw as Partial<AiChatRequest> | null;
  if (!body || typeof body.message !== "string" || !body.message.trim()) {
    throw new HttpsError("invalid-argument", "'message' is required.");
  }
  if (typeof body.conversationId !== "string" || !body.conversationId.trim()) {
    throw new HttpsError("invalid-argument", "'conversationId' is required.");
  }
  if (body.message.length > 4000) {
    throw new HttpsError("invalid-argument", "'message' is too long.");
  }
  return { message: body.message, conversationId: body.conversationId };
}

export const aiChat = onCall(
  {
    region: "us-central1",
    // Bound here so the key is materialised from Secret Manager for this
    // function only, and read at call time (see config.ts). It is never an
    // env var in the deploy, and never a VITE_* value in the client bundle.
    secrets: [AI_API_KEY],
    // Comfortably above AI_TIMEOUT_MS's default so a slow model call fails
    // as a provider timeout we can report, not an opaque function timeout.
    timeoutSeconds: 120,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in required.");
    }

    const { message, conversationId } = validateRequest(request.data);

    const ctx = await resolveToolContext(request.auth.uid, conversationId);

    try {
      requireActiveAccount(ctx);
    } catch {
      throw new HttpsError(
        "permission-denied",
        "This account is not yet linked to a hotel."
      );
    }

    return handleTurn(ctx, message);
  }
);
