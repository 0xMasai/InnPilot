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
import { defineSecret } from "firebase-functions/params";
import { resolveToolContext } from "./contextManager";
import { requireActiveAccount } from "./permissionGuard";
import { handleTurn } from "./orchestrator";

/**
 * The LLM credential, bound to this function below so it lands in
 * `process.env.AI_API_KEY` at runtime — where `provider.ts` reads it.
 * Set it with: firebase functions:secrets:set AI_API_KEY
 *
 * AI_PROVIDER / AI_MODEL / AI_MAX_TOKENS / AI_EFFORT are non-secret and
 * come from `functions/.env` (see functions/.env.example).
 */
const aiApiKey = defineSecret("AI_API_KEY");

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
    secrets: [aiApiKey],
    // Comfortably longer than the provider's own request timeout, so a slow
    // model surfaces as a provider error rather than a function timeout.
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
