/**
 * Vercel adapter for the AI gateway.
 *
 * HTTP concerns only — method, CORS, bearer token, status codes. Every
 * decision that matters (who the caller is, what they may do, what the
 * agent replies) lives in `server/ai/aiChat.ts` and the modules it calls,
 * so moving hosts again means rewriting this file and nothing else.
 *
 * Environment (set in the Vercel project's settings, never in the repo):
 *   AI_API_KEY                the provider credential
 *   AI_PROVIDER / AI_MODEL / AI_MAX_TOKENS / AI_EFFORT   see .env.example
 *   FIREBASE_SERVICE_ACCOUNT  service-account JSON, one line or base64
 *   ALLOWED_ORIGINS           optional, comma-separated; only needed when
 *                             the app is served from a different origin
 *                             than this function
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { AiChatError, handleAiChat } from "../server/ai/aiChat";

/**
 * Same-origin needs no CORS headers, so an unset ALLOWED_ORIGINS grants
 * nothing rather than defaulting to `*` — a wildcard here would let any
 * site spend this deployment's API budget with a stolen ID token.
 */
function applyCors(req: VercelRequest, res: VercelResponse): void {
  const allowed = (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  const origin = req.headers.origin;
  if (!origin || !allowed.includes(origin)) return;

  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function bearerToken(req: VercelRequest): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token || null;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  applyCors(req, res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  try {
    const response = await handleAiChat({
      idToken: bearerToken(req),
      body: req.body,
    });
    res.status(200).json(response);
  } catch (err) {
    if (err instanceof AiChatError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    // Anything unexpected: log it server-side, tell the client nothing
    // beyond "it failed" — error text can carry hotel data.
    console.error("aiChat failed:", err);
    res.status(500).json({ error: "The assistant is unavailable right now." });
  }
}
