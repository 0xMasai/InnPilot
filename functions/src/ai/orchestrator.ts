/**
 * Agent Orchestrator.
 *
 * A turn runs: history in -> provider -> (tool calls -> results -> provider)*
 * -> reply persisted. The system prompt is built here, and only here, via
 * `systemPrompt.ts#buildSystemPrompt`; no other module defines agent
 * instructions.
 *
 * Two invariants hold throughout:
 *
 *   - The model is only ever shown tools this caller is allowed to use
 *     (`toolsFor`), and the same filtered list is what the prompt renders —
 *     so the prompt, the advertised schemas, and what the Permission Guard
 *     will actually permit can never disagree.
 *   - Tool results are the only source of facts. A failed or denied tool
 *     comes back to the model marked as an error, never as a value.
 *
 * Still to come: Phase 6 tunes tool *selection* (fewer, better-chosen
 * calls); Phase 10 routes write tools through the Confirmation Manager;
 * Phase 12 writes each call to the audit log.
 */
import { logger } from "firebase-functions";
import type { AgentResponse, ToolContext } from "./types";
import { appendMessage, getRecentMessages, type StoredMessage } from "./conversationManager";
import { listTools } from "./toolRegistry";
import { buildSystemPrompt } from "./systemPrompt";
import { executeTool, toolsFor } from "./toolRunner";
import { createHotelData } from "./data/hotelData";
import {
  getProvider,
  AIProviderError,
  type ProviderToolResult,
  type ProviderTurn,
} from "./provider";
import { AIConfigError } from "./config";
import type { ToolCallRecord, ToolDeps } from "./types";

/**
 * Hard ceiling on provider round-trips per turn. Multi-area questions ("how
 * is the hotel doing?") legitimately need two or three; anything beyond this
 * is a loop, not an answer, and would burn the user's money and the
 * function's timeout.
 */
const MAX_TOOL_ROUNDS = 4;

const NOT_CONFIGURED_REPLY =
  "InnPilot AI isn't connected to an AI provider yet, so I can't answer. " +
  "Ask an administrator to configure the assistant.";

const PROVIDER_FAILED_REPLY =
  "I couldn't reach the AI service just now, so I have no answer for you — " +
  "nothing was retrieved and nothing was changed. Please try again in a moment.";

const REFUSED_REPLY =
  "I can't help with that request. Ask me about this hotel's operations instead.";

const NO_ANSWER_REPLY =
  "I gathered the data but couldn't put together an answer. Please ask again, " +
  "or narrow the question.";

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

  const { reply, toolCalls } = await generateReply(ctx, hotelId);

  await appendMessage({
    hotelId,
    conversationId: ctx.conversationId,
    role: "assistant",
    content: reply,
  });

  return {
    conversationId: ctx.conversationId,
    reply,
    toolCalls,
  };
}

interface TurnResult {
  reply: string;
  toolCalls: ToolCallRecord[];
}

async function generateReply(ctx: ToolContext, hotelId: string): Promise<TurnResult> {
  let provider;
  try {
    provider = await getProvider();
  } catch (error) {
    // A misconfigured deploy is an operator problem, not the user's — say
    // nothing about the hotel, and make the cause visible in the logs.
    logger.error("AI provider configuration is invalid", {
      error: error instanceof AIConfigError ? error.message : String(error),
    });
    return { reply: NOT_CONFIGURED_REPLY, toolCalls: [] };
  }

  if (!provider) return { reply: NOT_CONFIGURED_REPLY, toolCalls: [] };

  const history = await getRecentMessages(hotelId, ctx.conversationId);
  const turns = toProviderTurns(history);
  if (turns.length === 0) return { reply: PROVIDER_FAILED_REPLY, toolCalls: [] };

  // One data loader per turn: several tools in this turn share one Firestore
  // read per collection, and no turn can ever see another turn's data.
  const deps: ToolDeps = { data: createHotelData(hotelId), now: new Date() };

  // The caller's permitted tools drive BOTH the prompt and the schemas sent
  // to the provider, so the model is never told about a tool it would be
  // denied.
  const allowedTools = toolsFor(ctx, listTools());
  const systemPrompt = buildSystemPrompt({ ctx, tools: allowedTools, now: deps.now });
  const toolSchemas = allowedTools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));

  const toolCalls: ToolCallRecord[] = [];

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const response = await provider.generate({
        systemPrompt,
        messages: turns,
        tools: toolSchemas,
      });

      logger.info("ai.turn.round", {
        conversationId: ctx.conversationId,
        round,
        provider: provider.name,
        model: provider.model,
        stopReason: response.stopReason,
        toolUses: response.toolUses.length,
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
      });

      if (response.stopReason === "refusal") {
        return { reply: REFUSED_REPLY, toolCalls };
      }

      if (response.toolUses.length === 0) {
        const text = response.text.trim();
        return { reply: text || NO_ANSWER_REPLY, toolCalls };
      }

      // Record the model's turn verbatim, then run every requested tool and
      // send all results back in one round — which is what keeps parallel
      // tool calls working.
      turns.push({
        role: "assistant",
        text: response.text,
        toolUses: response.toolUses,
      });

      const results: ProviderToolResult[] = [];
      for (const toolUse of response.toolUses) {
        const record = await executeTool(ctx, deps, toolUse.name, toolUse.input);
        toolCalls.push(record);

        await appendMessage({
          hotelId,
          conversationId: ctx.conversationId,
          role: "tool",
          toolName: record.toolName,
          content: summariseForHistory(record),
        });

        results.push({
          toolUseId: toolUse.id,
          content:
            record.status === "ok"
              ? JSON.stringify(record.output)
              : (record.errorMessage ?? "Tool failed."),
          isError: record.status !== "ok",
        });
      }

      turns.push({ role: "tool", results });
    }

    // Out of rounds: report the ceiling rather than answering from a
    // half-finished investigation.
    logger.warn("ai.turn.round_limit", {
      conversationId: ctx.conversationId,
      rounds: MAX_TOOL_ROUNDS,
      toolCalls: toolCalls.length,
    });
    return {
      reply:
        "That question needed more steps than I'm allowed in one turn. Try asking " +
        "for one thing at a time — for example a single period or a single area.",
      toolCalls,
    };
  } catch (error) {
    logger.error("ai.turn.provider_error", {
      conversationId: ctx.conversationId,
      provider: provider.name,
      model: provider.model,
      retryable: error instanceof AIProviderError ? error.retryable : undefined,
      status: error instanceof AIProviderError ? error.status : undefined,
      error: error instanceof Error ? error.message : String(error),
    });
    return { reply: PROVIDER_FAILED_REPLY, toolCalls };
  }
}

/** Compact, PII-light record of a tool call for the stored history. */
function summariseForHistory(record: ToolCallRecord): string {
  return record.status === "ok"
    ? `${record.toolName}: ok (${record.durationMs}ms)`
    : `${record.toolName}: ${record.status} — ${record.errorMessage ?? "failed"}`;
}
