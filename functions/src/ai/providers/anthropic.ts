/**
 * Anthropic implementation of `AIProvider`.
 *
 * The only file in this package that imports a vendor LLM SDK. Everything
 * vendor-shaped (content blocks, betas, thinking config) is translated
 * here, so the orchestrator and tools stay provider-agnostic and a second
 * provider can be added without touching them.
 *
 * Model, key, token cap, and effort all arrive as a ProviderConfig built
 * from environment variables — nothing is hard-coded here except the SDK
 * call shape itself.
 */
import Anthropic from "@anthropic-ai/sdk";
import type {
  AIProvider,
  ProviderConfig,
  ProviderRequest,
  ProviderResponse,
  ProviderStopReason,
  ProviderToolUse,
} from "../provider";
import { ProviderRequestError } from "../provider";

/**
 * Cap a single call well inside the callable's own timeout
 * (`timeoutSeconds` in gateway.ts) so a slow upstream surfaces as our
 * error, not an opaque function timeout. The SDK default is 10 minutes.
 */
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_RETRIES = 1;

/**
 * Server-side refusal fallback: if the model declines a request for policy
 * reasons, the API re-runs it on a fallback model within the same call
 * rather than returning nothing. `"default"` lets the API pick the
 * fallback, so there is no second model id to keep current here.
 */
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

function mapStopReason(reason: string | null): ProviderStopReason {
  switch (reason) {
    case "end_turn":
    case "tool_use":
    case "max_tokens":
    case "refusal":
      return reason;
    default:
      return "other";
  }
}

export function createAnthropicProvider(config: ProviderConfig): AIProvider {
  const client = new Anthropic({
    apiKey: config.apiKey,
    timeout: REQUEST_TIMEOUT_MS,
    maxRetries: MAX_RETRIES,
  });

  return {
    providerName: "anthropic",
    model: config.model,

    async generate(request: ProviderRequest): Promise<ProviderResponse> {
      let message;
      try {
        message = await client.beta.messages.create({
          model: config.model,
          max_tokens: config.maxTokens,
          system: request.system,
          messages: request.messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          ...(request.tools?.length
            ? {
                tools: request.tools.map((t) => ({
                  name: t.name,
                  description: t.description,
                  input_schema: t.inputSchema as Anthropic.Beta.BetaTool["input_schema"],
                })),
              }
            : {}),
          thinking: { type: "adaptive" },
          output_config: { effort: config.effort },
          betas: [FALLBACK_BETA],
          fallbacks: "default",
        });
      } catch (err) {
        if (err instanceof Anthropic.APIError) {
          // Message text may contain the request payload; keep the thrown
          // error to status + type so nothing user-supplied is re-surfaced.
          throw new ProviderRequestError(
            `Anthropic request failed (${err.name}).`,
            err.status
          );
        }
        throw new ProviderRequestError(
          err instanceof Error ? err.message : "Unknown provider failure."
        );
      }

      const textParts: string[] = [];
      const toolUses: ProviderToolUse[] = [];

      for (const block of message.content) {
        if (block.type === "text") {
          textParts.push(block.text);
        } else if (block.type === "tool_use") {
          toolUses.push({ id: block.id, name: block.name, input: block.input });
        }
        // thinking / other block types are intentionally not surfaced —
        // callers replay them via `raw`, they are never shown to users.
      }

      return {
        text: textParts.join("\n").trim(),
        toolUses,
        stopReason: mapStopReason(message.stop_reason),
        model: message.model,
        usage: {
          inputTokens: message.usage.input_tokens,
          outputTokens: message.usage.output_tokens,
        },
        raw: message.content,
      };
    },
  };
}
