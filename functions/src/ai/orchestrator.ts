/**
 * Agent Orchestrator.
 *
 * Phase 2 scope only: this wires every other module together and defines
 * the shape of a turn, but does not yet call an LLM (Phase 3) or have any
 * tools to select from (Phase 4/10). Until then it always returns a plain,
 * honest "not available yet" reply — never a fabricated answer — so the
 * Gateway is safe to deploy and exercise end-to-end before the AI
 * provider exists.
 *
 * Once Phase 3/4 land, `handleTurn` is where: the provider is called with
 * the system prompt + tool schemas + recent history: any tool_use the
 * model requests is checked by permissionGuard, then executed via
 * toolRegistry; write tools go through confirmationManager first; every
 * tool call (and the final reply) is recorded via conversationManager and
 * auditLogger.
 */
import type { AgentResponse, ToolContext } from "./types";
import { appendMessage } from "./conversationManager";
import { listTools } from "./toolRegistry";

export async function handleTurn(
  ctx: ToolContext,
  userMessage: string
): Promise<AgentResponse> {
  await appendMessage({
    hotelId: ctx.hotelId as string, // permissionGuard has already required this by the time we get here
    conversationId: ctx.conversationId,
    role: "user",
    content: userMessage,
  });

  const availableTools = listTools();

  const reply =
    availableTools.length === 0
      ? "InnPilot AI isn't fully set up yet — the assistant infrastructure is in place, but no data tools or AI provider are connected. Nothing here is answering questions from real data yet."
      : "InnPilot AI's provider isn't configured yet, so I can't generate a response.";

  await appendMessage({
    hotelId: ctx.hotelId as string,
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
