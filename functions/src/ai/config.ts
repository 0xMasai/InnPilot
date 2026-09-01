/**
 * AI provider configuration (Phase 3).
 *
 * Everything the AI provider needs comes from the environment — nothing is
 * hard-coded here except safe, documented fallbacks for non-secret values,
 * and no value may ever reach the browser:
 *
 *   - The API key is a Cloud Functions secret (Google Secret Manager) bound
 *     to the function via `defineSecret`, never a plain env var and never a
 *     `VITE_*` value. The repo's `VITE_*` convention is for values that are
 *     deliberately bundled into public client JS (see `firebase.ts`); an LLM
 *     API key is the opposite of that.
 *   - The rest (provider, model, limits) are ordinary env vars, set for
 *     deploys through `functions/.env` (see `functions/.env.example`).
 *
 * `readAIConfig()` distinguishes two failure modes on purpose:
 *   - AI_PROVIDER unset  -> returns null. The agent is simply not connected
 *     yet; the Orchestrator degrades to an honest "not configured" reply.
 *   - AI_PROVIDER set to something unusable -> throws. A typo in a deploy
 *     should be loud, not silently downgraded to a broken assistant.
 */
import { defineSecret } from "firebase-functions/params";

/** Bound to the callable in gateway.ts via `onCall({ secrets: [...] })`. */
export const AI_API_KEY = defineSecret("AI_API_KEY");

export const PROVIDER_NAMES = ["anthropic"] as const;
export type ProviderName = (typeof PROVIDER_NAMES)[number];

export interface AIConfig {
  provider: ProviderName;
  /** Provider-specific model id, e.g. "claude-opus-5". */
  model: string;
  maxTokens: number;
  requestTimeoutMs: number;
  /** SDK-level retries for transient failures (on top of the first attempt). */
  maxRetries: number;
  /** Provider-specific reasoning effort; undefined means "provider default". */
  effort?: string;
}

export class AIConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AIConfigError";
  }
}

/**
 * Documented defaults per provider. These are model *identifiers*, not
 * secrets or account-specific IDs, and every one is overridable with
 * AI_MODEL — a deploy never has to edit code to change model.
 */
const DEFAULT_MODEL: Record<ProviderName, string> = {
  anthropic: "claude-opus-5",
};

const DEFAULT_MAX_TOKENS = 4096;

/**
 * Worst-case provider time is requestTimeoutMs x (maxRetries + 1), and that
 * product must stay under the aiChat callable's timeoutSeconds (120s) — or a
 * slow provider surfaces as an opaque function timeout instead of an error
 * we can report honestly. 50s x 2 = 100s leaves room for Firestore I/O.
 */
const DEFAULT_TIMEOUT_MS = 50_000;
const DEFAULT_MAX_RETRIES = 1;

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new AIConfigError(`${name} must be a positive integer, got '${raw}'.`);
  }
  return parsed;
}

function readNonNegativeInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new AIConfigError(`${name} must be a non-negative integer, got '${raw}'.`);
  }
  return parsed;
}

/**
 * @returns the resolved config, or null when no provider is configured.
 * @throws AIConfigError when a value is present but unusable.
 */
export function readAIConfig(): AIConfig | null {
  const rawProvider = (process.env.AI_PROVIDER ?? "").trim().toLowerCase();
  if (!rawProvider) return null;

  if (!PROVIDER_NAMES.includes(rawProvider as ProviderName)) {
    throw new AIConfigError(
      `AI_PROVIDER='${rawProvider}' is not supported. Supported: ${PROVIDER_NAMES.join(", ")}.`
    );
  }
  const provider = rawProvider as ProviderName;

  const model = (process.env.AI_MODEL ?? "").trim() || DEFAULT_MODEL[provider];
  const effort = (process.env.AI_EFFORT ?? "").trim() || undefined;

  return {
    provider,
    model,
    maxTokens: readPositiveInt("AI_MAX_TOKENS", DEFAULT_MAX_TOKENS),
    requestTimeoutMs: readPositiveInt("AI_TIMEOUT_MS", DEFAULT_TIMEOUT_MS),
    maxRetries: readNonNegativeInt("AI_MAX_RETRIES", DEFAULT_MAX_RETRIES),
    effort,
  };
}

/**
 * The API key, read at call time (secrets are only materialised once the
 * function is running, never at module load).
 */
export function readApiKey(): string {
  const value = AI_API_KEY.value();
  if (!value) {
    throw new AIConfigError(
      "AI_API_KEY is not set. Run: firebase functions:secrets:set AI_API_KEY"
    );
  }
  return value;
}
