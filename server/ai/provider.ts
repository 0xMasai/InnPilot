/**
 * AI Provider abstraction.
 *
 * The rest of the agent talks to an LLM only through the `AIProvider`
 * interface below — nothing outside `providers/` imports a vendor SDK, and
 * nothing anywhere hard-codes a model id, endpoint, or key. Which provider
 * and model are used is decided entirely by environment variables read at
 * runtime (see `functions/.env.example`):
 *
 *   AI_PROVIDER   which implementation to construct  (default: "openai")
 *   AI_MODEL      model id for that provider         (default: per-provider)
 *   AI_API_KEY    credential — a host secret, never a committed value
 *   AI_MAX_TOKENS optional response cap              (default: 4096)
 *   AI_EFFORT     optional reasoning effort          (default: "medium")
 *
 * `AI_API_KEY` deliberately has no `VITE_` prefix: this repo's Vite
 * convention (`firebase.ts`) bundles `VITE_*` into public client JS, which
 * an LLM key must never be. It comes from the secret store of whatever
 * host runs the gateway; this module only ever reads `process.env`, so it
 * is host-agnostic and testable with a plain object.
 */

import { createOpenAIProvider } from "./providers/openai";

/**
 * One entry in the transcript sent to a provider.
 *
 * `assistant` turns carry `raw` — the provider's own representation of
 * that turn — because a tool round-trip has to replay the model's own tool
 * call before its result is accepted, and reasoning models additionally
 * require their reasoning items echoed back verbatim. Callers get `raw`
 * from a previous `ProviderResponse` and pass it straight back; they never
 * inspect it. Turns rebuilt from stored history simply omit it.
 */
export type ProviderTurn =
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string;
      toolUses?: ProviderToolUse[];
      raw?: unknown;
    }
  | {
      role: "tool_result";
      toolUseId: string;
      toolName: string;
      /** JSON the tool returned, or a JSON error object. Never prose. */
      content: string;
    };

/**
 * A tool as described *to the model*. Deliberately a plain JSON Schema
 * object rather than any vendor's tool type — `toolRegistry.ts` owns the
 * real definitions (Phase 4), and the provider only ever sees name,
 * description, and schema.
 */
export interface ProviderToolSchema {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** A tool the model asked to call. Nothing is executed by this layer. */
export interface ProviderToolUse {
  id: string;
  name: string;
  input: unknown;
}

export interface ProviderRequest {
  system: string;
  /** Chronological; must start with a user turn. */
  messages: ProviderTurn[];
  tools?: ProviderToolSchema[];
}

export type ProviderStopReason =
  | "end_turn"
  | "tool_use"
  | "max_tokens"
  | "refusal"
  | "other";

export interface ProviderResponse {
  /** Concatenated text the model produced. May be empty on a tool-use turn. */
  text: string;
  toolUses: ProviderToolUse[];
  stopReason: ProviderStopReason;
  /** The model that actually served the response. */
  model: string;
  usage: { inputTokens: number; outputTokens: number };
  /**
   * The provider's own assistant content, opaque to every caller except
   * when echoing it back to the *same* provider in a later turn (Phase 6's
   * tool loop needs this — some providers require their reasoning blocks
   * to be replayed verbatim). Never persist or render this.
   */
  raw: unknown;
}

export interface AIProvider {
  readonly providerName: string;
  readonly model: string;
  generate(request: ProviderRequest): Promise<ProviderResponse>;
}

/** The agent is misconfigured (missing key, unknown provider, bad value). */
export class ProviderConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderConfigurationError";
  }
}

/** A configured provider was called and the call failed. */
export class ProviderRequestError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "ProviderRequestError";
    this.status = status;
  }
}

export type Effort = "low" | "medium" | "high";

export interface ProviderConfig {
  provider: string;
  model: string;
  apiKey: string;
  maxTokens: number;
  effort: Effort;
}

export type ProviderFactory = (config: ProviderConfig) => AIProvider;

/** Per-provider defaults, so `AI_MODEL` is optional in every environment. */
const DEFAULT_MODELS: Record<string, string> = {
  openai: "gpt-5.6",
};

const DEFAULT_PROVIDER = "openai";
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_EFFORT: Effort = "medium";

const VALID_EFFORTS: readonly Effort[] = ["low", "medium", "high"];

type Env = Record<string, string | undefined>;

function read(env: Env, key: string): string | undefined {
  const value = env[key];
  return value && value.trim() ? value.trim() : undefined;
}

/**
 * True when enough configuration exists to construct a provider. Callers
 * use this to degrade honestly ("I can't answer that right now") instead of
 * throwing at users for what is an operator-side problem.
 */
export function isProviderConfigured(env: Env = process.env): boolean {
  return read(env, "AI_API_KEY") !== undefined;
}

export function resolveProviderConfig(env: Env = process.env): ProviderConfig {
  const provider = (read(env, "AI_PROVIDER") ?? DEFAULT_PROVIDER).toLowerCase();

  if (!(provider in DEFAULT_MODELS)) {
    throw new ProviderConfigurationError(
      `Unsupported AI_PROVIDER '${provider}'. Supported: ${Object.keys(DEFAULT_MODELS).join(", ")}.`
    );
  }

  const apiKey = read(env, "AI_API_KEY");
  if (!apiKey) {
    throw new ProviderConfigurationError(
      "AI_API_KEY is not set. Provide it as a secret/environment variable on the host running the gateway."
    );
  }

  const rawMaxTokens = read(env, "AI_MAX_TOKENS");
  const maxTokens = rawMaxTokens ? Number(rawMaxTokens) : DEFAULT_MAX_TOKENS;
  if (!Number.isInteger(maxTokens) || maxTokens <= 0) {
    throw new ProviderConfigurationError(
      `AI_MAX_TOKENS must be a positive integer, got '${rawMaxTokens}'.`
    );
  }

  const rawEffort = read(env, "AI_EFFORT")?.toLowerCase();
  if (rawEffort && !VALID_EFFORTS.includes(rawEffort as Effort)) {
    throw new ProviderConfigurationError(
      `AI_EFFORT must be one of ${VALID_EFFORTS.join(" | ")}, got '${rawEffort}'.`
    );
  }

  return {
    provider,
    model: read(env, "AI_MODEL") ?? DEFAULT_MODELS[provider],
    apiKey,
    maxTokens,
    effort: (rawEffort as Effort | undefined) ?? DEFAULT_EFFORT,
  };
}

/**
 * Provider implementations, by `AI_PROVIDER` value. Adding another means
 * adding one file under `providers/` plus one entry here and in
 * DEFAULT_MODELS — no caller changes. (An Anthropic implementation lived
 * here until this package merged with the frontend's: a second SDK is
 * statically imported into every install and every function bundle, so it
 * was dropped rather than carried unused. See git history for the shape.)
 */
const FACTORIES: Record<string, ProviderFactory> = {
  openai: (config) => createOpenAIProvider(config),
};

let cached: { key: string; provider: AIProvider } | null = null;

/**
 * The configured provider, constructed once per container (clients are
 * reusable and cold starts are expensive). Throws
 * ProviderConfigurationError if the environment can't produce one.
 */
export function getProvider(env: Env = process.env): AIProvider {
  const config = resolveProviderConfig(env);
  // The key includes the credential so a rotated secret rebuilds the
  // client instead of reusing one holding the old key. It stays in
  // process memory only — never logged, never returned.
  const key = `${config.provider}:${config.model}:${config.maxTokens}:${config.effort}:${config.apiKey}`;

  if (cached?.key !== key) {
    cached = { key, provider: FACTORIES[config.provider](config) };
  }

  return cached.provider;
}

/** Test seam: drops the memoized provider. */
export function resetProviderCache(): void {
  cached = null;
}
