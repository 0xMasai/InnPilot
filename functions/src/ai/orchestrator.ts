/**
 * Agent Orchestrator.
 *
 * Phase 3 scope: the LLM is now wired in behind the provider abstraction,
 * so a turn is a real model turn. Still deliberately absent:
 *   - tools (Phase 4/10) — `listTools()` is empty, so no tool schemas are
 *     sent and no tool_use can come back;
 *   - the real system prompt (Phase 7) — the placeholder below is the
 *     minimum needed to keep the model honest until then;
 *   - the tool-execution loop (Phase 6), permission checks per tool call
 *     (Phase 5), and confirmation-gated writes (Phase 10).
 *
 * The honesty rule from the brief governs every failure path here: if the
 * provider is unconfigured or the call fails, say so plainly. Never answer
 * an operational question from the model's own guesswork.
 */
import type { AgentResponse, ToolContext } from "./types";
import { appendMessage, getRecentMessages } from "./conversationManager";
import { listTools } from "./toolRegistry";
import {
  ProviderConfigurationError,
  ProviderRequestError,
  getProvider,
  isProviderConfigured,
} from "./provider";
import type { ProviderMessage } from "./provider";

/** How many prior messages of context the model gets. */
const HISTORY_LIMIT = 20;

const NOT_CONFIGURED_REPLY =
  "InnPilot AI isn't switched on for this deployment yet — no AI provider is configured, so I can't answer questions about your hotel's data. Ask your administrator to configure the assistant.";

const PROVIDER_FAILED_REPLY =
  "I couldn't reach the AI service just now, so I have no answer for you rather than a guessed one. Please try again in a moment.";

const REFUSAL_REPLY =
  "I wasn't able to produce a response to that request. Try rephrasing it, or ask about a specific part of your hotel's operations.";

/**
 * Phase 7 replaces this with the full InnPilot system prompt (real roles,
 * tool-use rules, confirmation rules, report formats). Until then it states
 * only what is true today: there are no tools, so there are no facts to
 * give, and inventing them is not an option.
 */
function buildSystemPrompt(ctx: ToolContext, hasTools: boolean): string {
  const base = [
    "You are InnPilot AI, a hospitality operations assistant built into the InnPilot hotel management system.",
    `You are speaking with an authenticated InnPilot user whose role is '${ctx.role}'.`,
    "Be concise and practical, the way an experienced hotel operations manager would be.",
  ];

  if (!hasTools) {
    base.push(
      "You currently have NO access to this hotel's data: no reporting, reservation, revenue, expense, room, or guest tools are connected yet.",
      "Never state, estimate, or guess any operational, financial, reservation, or guest figure. If the user asks for one, say plainly that data access is not connected yet and that you cannot retrieve it.",
      "You may still explain what InnPilot does and answer general hospitality questions."
    );
  }

  return base.join(" ");
}

/**
 * Firestore history -> provider messages. Tool messages are dropped (they
 * have no meaning to the model until Phase 6 replays them properly), and
 * any leading assistant messages are trimmed because a turn must start
 * with a user message.
 */
function toProviderMessages(
  history: { role: string; content: string }[]
): ProviderMessage[] {
  const messages = history
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role as ProviderMessage["role"], content: m.content }))
    .filter((m) => m.content.trim().length > 0);

  const firstUser = messages.findIndex((m) => m.role === "user");
  return firstUser === -1 ? [] : messages.slice(firstUser);
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

  const reply = await generateReply(ctx, hotelId, userMessage);

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

async function generateReply(
  ctx: ToolContext,
  hotelId: string,
  userMessage: string
): Promise<string> {
  if (!isProviderConfigured()) {
    return NOT_CONFIGURED_REPLY;
  }

  const history = await getRecentMessages(
    hotelId,
    ctx.conversationId,
    HISTORY_LIMIT
  );

  // The just-appended user message may not be readable yet (its
  // serverTimestamp resolves on write); fall back to it directly so the
  // model always sees the question it is answering.
  const messages = toProviderMessages(history);
  if (messages.length === 0 || messages[messages.length - 1]?.role !== "user") {
    messages.push({ role: "user", content: userMessage });
  }

  try {
    const provider = getProvider();
    const response = await provider.generate({
      system: buildSystemPrompt(ctx, listTools().length > 0),
      messages,
      // No tools until Phase 4 registers them.
    });

    if (response.stopReason === "refusal") {
      return REFUSAL_REPLY;
    }

    return response.text || REFUSAL_REPLY;
  } catch (err) {
    if (err instanceof ProviderConfigurationError) {
      console.error("AI provider misconfigured:", err.message);
      return NOT_CONFIGURED_REPLY;
    }
    if (err instanceof ProviderRequestError) {
      console.error("AI provider request failed:", err.status, err.message);
      return PROVIDER_FAILED_REPLY;
    }
    throw err;
  }
}
