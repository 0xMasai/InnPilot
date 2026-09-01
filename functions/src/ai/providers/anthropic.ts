/**
 * Anthropic implementation of the AIProvider interface (Phase 3).
 *
 * The only file in this package that knows a vendor SDK exists. It maps the
 * neutral ProviderRequest/ProviderResponse shapes onto the Messages API and
 * back, and translates SDK errors into AIProviderError so callers never
 * have to catch vendor types.
 *
 * Model, limits, and key all come from config.ts (environment/secret), so
 * nothing here is account- or deployment-specific.
 */
import Anthropic from "@anthropic-ai/sdk";
import { readApiKey, type AIConfig } from "../config";
import { AIProviderError } from "../provider";
import type {
  AIProvider,
  ProviderRequest,
  ProviderResponse,
  ProviderStopReason,
  ProviderTurn,
} from "../provider";

function toMessageParams(turns: ProviderTurn[]): Anthropic.MessageParam[] {
  const messages: Anthropic.MessageParam[] = [];

  for (const turn of turns) {
    if (turn.role === "user") {
      messages.push({ role: "user", content: turn.text });
      continue;
    }

    if (turn.role === "assistant") {
      const blocks: Anthropic.ContentBlockParam[] = [];
      if (turn.text.trim()) {
        blocks.push({ type: "text", text: turn.text });
      }
      for (const use of turn.toolUses ?? []) {
        blocks.push({
          type: "tool_use",
          id: use.id,
          name: use.name,
          input: (use.input ?? {}) as Record<string, unknown>,
        });
      }
      // An assistant turn with neither text nor tool calls is not a legal
      // message; skipping it is safer than sending an empty content array.
      if (blocks.length > 0) {
        messages.push({ role: "assistant", content: blocks });
      }
      continue;
    }

    // Tool results are sent as a user turn — all results from one round in a
    // single message, which is what keeps parallel tool use working.
    messages.push({
      role: "user",
      content: turn.results.map((result) => ({
        type: "tool_result" as const,
        tool_use_id: result.toolUseId,
        content: result.content,
        is_error: result.isError ?? false,
      })),
    });
  }

  return messages;
}

function toStopReason(raw: Anthropic.Message["stop_reason"]): ProviderStopReason {
  switch (raw) {
    case "end_turn":
    case "stop_sequence":
      return "end_turn";
    case "tool_use":
      return "tool_use";
    case "max_tokens":
      return "max_tokens";
    case "refusal":
      return "refusal";
    default:
      return "other";
  }
}

function toProviderError(error: unknown): AIProviderError {
  if (error instanceof Anthropic.APIError) {
    const status = error.status;
    const retryable =
      status === undefined || status === 408 || status === 409 || status === 429 || status >= 500;
    // error.message is the provider's own text; it never contains the key.
    return new AIProviderError(`Anthropic API error: ${error.message}`, {
      retryable,
      status,
    });
  }

  const message = error instanceof Error ? error.message : String(error);
  return new AIProviderError(`Anthropic request failed: ${message}`, { retryable: true });
}

export function createAnthropicProvider(config: AIConfig): AIProvider {
  const client = new Anthropic({
    apiKey: readApiKey(),
    timeout: config.requestTimeoutMs,
    maxRetries: config.maxRetries,
  });

  return {
    name: "anthropic",
    model: config.model,

    async generate(request: ProviderRequest): Promise<ProviderResponse> {
      let message: Anthropic.Message;
      try {
        message = await client.messages.create({
          model: config.model,
          max_tokens: config.maxTokens,
          system: request.systemPrompt,
          messages: toMessageParams(request.messages),
          // Omitted entirely when there are no tools: an empty array is a
          // different request than "no tools declared".
          ...(request.tools.length > 0
            ? {
                tools: request.tools.map((tool) => ({
                  name: tool.name,
                  description: tool.description,
                  input_schema: tool.inputSchema as Anthropic.Tool["input_schema"],
                })),
              }
            : {}),
          ...(config.effort
            ? { output_config: { effort: config.effort as "low" | "medium" | "high" | "xhigh" | "max" } }
            : {}),
        });
      } catch (error) {
        throw toProviderError(error);
      }

      let text = "";
      const toolUses: ProviderResponse["toolUses"] = [];

      for (const block of message.content) {
        if (block.type === "text") {
          text += block.text;
        } else if (block.type === "tool_use") {
          toolUses.push({ id: block.id, name: block.name, input: block.input });
        }
        // thinking/other block types carry no answer text and are not
        // replayed by this layer — the orchestrator stores plain text.
      }

      return {
        text,
        toolUses,
        stopReason: toStopReason(message.stop_reason),
        usage: {
          inputTokens: message.usage.input_tokens,
          outputTokens: message.usage.output_tokens,
        },
      };
    },
  };
}
