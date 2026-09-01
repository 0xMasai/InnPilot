/**
 * AI provider abstraction (Phase 3).
 *
 * The Orchestrator talks to *this* interface, never to a vendor SDK. The
 * shapes below are deliberately vendor-neutral — a turn is text plus tool
 * calls plus tool results, which is the common denominator of every current
 * tool-calling API — so swapping providers is one new file under
 * `providers/` plus one line in `createProvider`, with no change to
 * orchestration, tools, prompt, or permission logic.
 *
 * What this layer deliberately does NOT do: interpret tool calls, decide
 * whether a tool may run, or execute anything. It converts messages to a
 * provider's wire format and back. Authorization stays in permissionGuard,
 * execution in toolRegistry, confirmation in confirmationManager.
 */
import { readAIConfig, type AIConfig } from "./config";

/** A tool the model may call, as advertised to the provider. */
export interface ProviderToolSchema {
  name: string;
  description: string;
  /** JSON Schema object describing the tool's input. */
  inputSchema: Record<string, unknown>;
}

export interface ProviderToolUse {
  /** Provider-issued id; echoed back on the matching result. */
  id: string;
  name: string;
  input: unknown;
}

export interface ProviderToolResult {
  toolUseId: string;
  /** Serialized result (or error text) shown to the model. */
  content: string;
  isError?: boolean;
}

export type ProviderTurn =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; toolUses?: ProviderToolUse[] }
  | { role: "tool"; results: ProviderToolResult[] };

export interface ProviderRequest {
  /** Built by systemPrompt.ts — the only source of agent instructions. */
  systemPrompt: string;
  messages: ProviderTurn[];
  tools: ProviderToolSchema[];
}

export type ProviderStopReason =
  | "end_turn"
  | "tool_use"
  | "max_tokens"
  | "refusal"
  | "other";

export interface ProviderResponse {
  text: string;
  toolUses: ProviderToolUse[];
  stopReason: ProviderStopReason;
  usage: { inputTokens: number; outputTokens: number };
}

export interface AIProvider {
  readonly name: string;
  readonly model: string;
  generate(request: ProviderRequest): Promise<ProviderResponse>;
}

/** Raised when no provider is configured — a deployment state, not a bug. */
export class AIProviderNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AIProviderNotConfiguredError";
  }
}

/**
 * Any failure talking to the provider. `retryable` marks transient causes
 * (rate limits, 5xx, network) so callers can distinguish "try again" from
 * "this request will never work". Never carries the API key or raw
 * request body — see auditLogger/Phase 13 for what gets logged.
 */
export class AIProviderError extends Error {
  readonly retryable: boolean;
  readonly status?: number;

  constructor(message: string, options: { retryable: boolean; status?: number }) {
    super(message);
    this.name = "AIProviderError";
    this.retryable = options.retryable;
    this.status = options.status;
  }
}

async function createProvider(config: AIConfig): Promise<AIProvider> {
  switch (config.provider) {
    case "anthropic": {
      // Imported lazily so a deploy configured for another provider never
      // pays this SDK's load cost at cold start.
      const { createAnthropicProvider } = await import("./providers/anthropic");
      return createAnthropicProvider(config);
    }
  }
}

let cached: AIProvider | null = null;

/**
 * @returns the configured provider, or null when AI_PROVIDER is unset.
 * @throws AIConfigError when configuration is present but unusable.
 *
 * Memoized for the lifetime of the function instance: config is fixed per
 * deploy, so re-reading it (and re-constructing an SDK client) on every
 * request would only add cold-path work.
 */
export async function getProvider(): Promise<AIProvider | null> {
  if (cached) return cached;

  const config = readAIConfig();
  if (!config) return null;

  cached = await createProvider(config);
  return cached;
}

/** Test seam: drops the memoized provider. */
export function resetProviderCache(): void {
  cached = null;
}
