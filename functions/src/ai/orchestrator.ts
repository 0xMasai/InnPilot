/**
 * Agent Orchestrator.
 *
 * Phase 3 scope: a turn is now real end-to-end — history in, provider call
 * out, reply persisted — but with an empty Tool Registry. That is deliberate
 * and safe: the system prompt (built here, and only here, via
 * `systemPrompt.ts#buildSystemPrompt` — no other module defines agent
 * instructions) tells the model it has no tools and must not answer
 * operational questions from guesswork, so an un-tooled deploy declines
 * rather than fabricates.
 *
 * Phase 4 registers read tools and Phase 6 adds the tool-call loop here:
 * any tool_use the model requests is checked by permissionGuard, then
 * executed via toolRegistry; write tools go through confirmationManager
 * first; every tool call is recorded via conversationManager and
 * auditLogger.
 */
import { logger } from "firebase-functions";
import type { AgentResponse, ToolContext } from "./types";
import { appendMessage, getRecentMessages, type StoredMessage } from "./conversationManager";
import { listTools } from "./toolRegistry";
import { buildSystemPrompt } from "./systemPrompt";
import { getProvider, AIProviderError, type ProviderTurn } from "./provider";
import { AIConfigError } from "./config";

const NOT_CONFIGURED_REPLY =
  "InnPilot AI isn't connected to an AI provider yet, so I can't answer. " +
  "Ask an administrator to configure the assistant.";

const PROVIDER_FAILED_REPLY =
  "I couldn't reach the AI service just now, so I have no answer for you — " +
  "nothing was retrieved and nothing was changed. Please try again in a moment.";

const REFUSED_REPLY =
  "I can't help with that request. Ask me about this hotel's operations instead.";

/**
 * Stored history -> provider turns. Tool messages are skipped: Phase 2's
 * message store keeps no tool_use ids, so they cannot be replayed as a
 * valid tool round-trip (Phase 6 extends the store when it needs them).
 * A conversation must also open on a user turn, so any leading assistant
 * messages are dropped rather than sent and rejected.
 */
function toProviderTurns(messages: StoredMessage[]): ProviderTurn[] {
  const turns: ProviderTurn[] = [];

  for (const message of messages) {
    if (message.role === "user") {
      turns.push({ role: "user", text: message.content });
    } else if (message.role === "assistant") {
      if (turns.length === 0) continue;
      turns.push({ role: "assistant", text: message.content });
    }
  }

  return turns;
}

export async function handleTurn(
  ctx: ToolContext,
  userMessage: string
): Promise<AgentResponse> {
  // permissionGuard has already required a hotel by the time we get here.
  const hotelId = ctx.hotelId as string;

  await appendMessage({
    hotelId,
    conversationId: ctx.conversationId,
    role: "user",
    content: userMessage,
  });

  const reply = await generateReply(ctx, hotelId);

  await appendMessage({
    hotelId,
    conversationId: ctx.conversationId,
    role: "assistant",
    content: reply,
  });

  return {
    conversationId: ctx.conversationId,
    reply,
    toolCalls: [],
  };
}

async function generateReply(ctx: ToolContext, hotelId: string): Promise<string> {
  let provider;
  try {
    provider = await getProvider();
  } catch (error) {
    // A misconfigured deploy is an operator problem, not the user's — say
    // nothing about the hotel, and make the cause visible in the logs.
    logger.error("AI provider configuration is invalid", {
      error: error instanceof AIConfigError ? error.message : String(error),
    });
    return NOT_CONFIGURED_REPLY;
  }

  if (!provider) return NOT_CONFIGURED_REPLY;

  const history = await getRecentMessages(hotelId, ctx.conversationId);
  const turns = toProviderTurns(history);
  if (turns.length === 0) return PROVIDER_FAILED_REPLY;

  try {
    const response = await provider.generate({
      systemPrompt: buildSystemPrompt({ ctx, tools: listTools() }),
      messages: turns,
      tools: [],
    });

    logger.info("ai.turn.completed", {
      conversationId: ctx.conversationId,
      provider: provider.name,
      model: provider.model,
      stopReason: response.stopReason,
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
    });

    if (response.stopReason === "refusal") return REFUSED_REPLY;

    const text = response.text.trim();
    return text || PROVIDER_FAILED_REPLY;
  } catch (error) {
    logger.error("ai.turn.provider_error", {
      conversationId: ctx.conversationId,
      provider: provider.name,
      model: provider.model,
      retryable: error instanceof AIProviderError ? error.retryable : undefined,
      status: error instanceof AIProviderError ? error.status : undefined,
      error: error instanceof Error ? error.message : String(error),
    });
    return PROVIDER_FAILED_REPLY;
  }
}
