/**
 * OpenAI implementation of `AIProvider`.
 *
 * Uses the Responses API (`client.responses.create`), which is OpenAI's
 * current surface for tool-calling models. Everything vendor-shaped —
 * function-tool definitions, output items, reasoning effort — is
 * translated here, so nothing outside this file knows which provider is
 * configured.
 *
 * Model, key, token cap, and effort all arrive as a ProviderConfig built
 * from environment variables; nothing is hard-coded here except the SDK
 * call shape.
 */
import OpenAI from "openai";
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
 * Cap a single call inside the host's request budget (Vercel's
 * `maxDuration` is 60s in vercel.json) so a slow upstream surfaces as our
 * error rather than an opaque platform timeout. SDK default: 10 minutes.
 */
const REQUEST_TIMEOUT_MS = 45_000;
const MAX_RETRIES = 1;

function parseToolArguments(raw: string, toolName: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    // Never hand a half-parsed object to a tool handler — fail the turn
    // instead, so the orchestrator reports "no answer" rather than acting
    // on arguments we couldn't read.
    throw new ProviderRequestError(
      `OpenAI returned unparseable arguments for tool '${toolName}'.`
    );
  }
}

export function createOpenAIProvider(config: ProviderConfig): AIProvider {
  const client = new OpenAI({
    apiKey: config.apiKey,
    timeout: REQUEST_TIMEOUT_MS,
    maxRetries: MAX_RETRIES,
  });

  return {
    providerName: "openai",
    model: config.model,

    async generate(request: ProviderRequest): Promise<ProviderResponse> {
      let response;
      try {
        response = await client.responses.create({
          model: config.model,
          instructions: request.system,
          input: request.messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          max_output_tokens: config.maxTokens,
          reasoning: { effort: config.effort },
          // Hotel operational data must not be retained provider-side for
          // OpenAI's 30-day conversation storage; we keep our own history
          // in Firestore (conversationManager.ts) instead.
          store: false,
          ...(request.tools?.length
            ? {
                tools: request.tools.map((t) => ({
                  type: "function" as const,
                  name: t.name,
                  description: t.description,
                  parameters: t.inputSchema,
                  strict: false,
                })),
              }
            : {}),
        });
      } catch (err) {
        if (err instanceof OpenAI.APIError) {
          // The SDK's message can echo the request payload (which carries
          // hotel data from Phase 4 on); keep the thrown error to type and
          // status only.
          throw new ProviderRequestError(
            `OpenAI request failed (${err.name}).`,
            err.status
          );
        }
        throw new ProviderRequestError(
          err instanceof Error ? err.message : "Unknown provider failure."
        );
      }

      const toolUses: ProviderToolUse[] = [];
      let refused = false;

      for (const item of response.output) {
        if (item.type === "function_call") {
          toolUses.push({
            id: item.call_id,
            name: item.name,
            input: parseToolArguments(item.arguments, item.name),
          });
        } else if (item.type === "message") {
          if (item.content.some((c) => c.type === "refusal")) {
            refused = true;
          }
        }
        // reasoning and other item types are not surfaced — callers replay
        // them via `raw`, they are never shown to users.
      }

      return {
        text: response.output_text.trim(),
        toolUses,
        stopReason: mapStopReason(response, toolUses.length > 0, refused),
        model: response.model,
        usage: {
          inputTokens: response.usage?.input_tokens ?? 0,
          outputTokens: response.usage?.output_tokens ?? 0,
        },
        raw: response.output,
      };
    },
  };
}

function mapStopReason(
  response: OpenAI.Responses.Response,
  hasToolUses: boolean,
  refused: boolean
): ProviderStopReason {
  if (refused || response.incomplete_details?.reason === "content_filter") {
    return "refusal";
  }
  if (response.incomplete_details?.reason === "max_output_tokens") {
    return "max_tokens";
  }
  if (hasToolUses) {
    return "tool_use";
  }
  return response.status === "completed" ? "end_turn" : "other";
}
