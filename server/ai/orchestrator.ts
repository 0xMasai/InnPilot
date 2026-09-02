/**
 * Agent Orchestrator.
 *
 * Phase 4 scope: the model can now call the read-only tools, so answers
 * come from this hotel's real data instead of an apology. A turn is:
 *
 *   history + question -> model -> [tool calls -> results -> model]* -> reply
 *
 * Every tool call goes through the registry and the Permission Guard, and
 * every tool's own `validateInput` runs before its handler — the model is
 * never trusted to send well-formed or permitted arguments, and it never
 * supplies hotelId or role (those come from ToolContext).
 *
 * Still deliberately absent: the real system prompt (Phase 7), tool-choice
 * tuning (Phase 6), write tools and confirmation (Phase 10), audit logging
 * of AI actions (Phase 12), structured logs (Phase 13).
 *
 * The honesty rule from the brief governs every failure path: if a tool
 * fails, the model is told it failed and must say so. Nothing here lets an
 * unanswerable question become an invented answer.
 */
import type { AgentResponse, ToolCallRecord, ToolContext, RegisteredTool } from "./types";
import { ToolAuthorizationError, ToolValidationError } from "./types";
import {
  appendMessage,
  claimConversation,
  getRecentMessages,
} from "./conversationManager";
import { getTool, listTools } from "./toolRegistry";
import { registerReadTools } from "./tools";
import { buildSystemPrompt } from "./systemPrompt";
import { fetchHotelName } from "./tools/dataAccess";
import { assertCanCallTool } from "./permissionGuard";
import {
  ProviderConfigurationError,
  ProviderRequestError,
  getProvider,
  isProviderConfigured,
} from "./provider";
import { withRequestCache } from "./requestCache";
import type { ProviderToolSchema, ProviderToolUse, ProviderTurn } from "./provider";

/** How many prior messages of context the model gets. */
const HISTORY_LIMIT = 20;

/**
 * How many times a turn may go model -> tools -> model. Two rounds covers
 * "look something up, then look up the thing that implies"; the cap is what
 * stops a confused model from looping until the platform kills the request.
 */
const MAX_TOOL_ROUNDS = 3;

/**
 * Total tool calls one question may cost. Three rounds of a model calling
 * everything it can think of is a bill and a latency problem; a question
 * that genuinely needs more than this is one the user should ask in parts.
 */
const MAX_TOOL_CALLS_PER_TURN = 8;

const BUDGET_EXHAUSTED_MESSAGE =
  "Tool call budget for this turn is exhausted. Answer from what you already retrieved, and say what you could not check.";

const NOT_CONFIGURED_REPLY =
  "InnPilot AI isn't switched on for this deployment yet — no AI provider is configured, so I can't answer questions about your hotel's data. Ask your administrator to configure the assistant.";

const PROVIDER_FAILED_REPLY =
  "I couldn't reach the AI service just now, so I have no answer for you rather than a guessed one. Please try again in a moment.";

const REFUSAL_REPLY =
  "I wasn't able to produce a response to that request. Try rephrasing it, or ask about a specific part of your hotel's operations.";

const TOOL_LOOP_EXHAUSTED_REPLY =
  "I looked up several things but couldn't settle on an answer. Try asking about one specific figure — occupancy, revenue, arrivals — and I'll go straight at it.";

function toolSchemas(tools: RegisteredTool[]): ProviderToolSchema[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));
}

/**
 * Firestore history -> provider turns. Tool messages are dropped: their
 * provider-specific call ids are gone by then, and a bare result without
 * the call it answers is not a valid transcript. Leading assistant turns
 * are trimmed because a turn must start with a user message.
 */
function toProviderTurns(history: { role: string; content: string }[]): ProviderTurn[] {
  const turns = history
    .filter((m) => m.role === "user" || m.role === "assistant")
    .filter((m) => m.content.trim().length > 0)
    .map((m) =>
      m.role === "user"
        ? ({ role: "user", content: m.content } as const)
        : ({ role: "assistant", content: m.content } as const)
    );

  const firstUser = turns.findIndex((t) => t.role === "user");
  return firstUser === -1 ? [] : turns.slice(firstUser);
}

interface ExecutedTool {
  /** Always a tool_result turn: every path here answers a specific call. */
  turn: Extract<ProviderTurn, { role: "tool_result" }>;
  record: ToolCallRecord;
}

/**
 * Run one tool call the model asked for. Never throws: a failure becomes a
 * result the model can read and report honestly, which is the whole point
 * — a thrown error would leave the user with a generic apology instead of
 * "I couldn't read the expenses".
 */
async function executeToolCall(
  ctx: ToolContext,
  call: ProviderToolUse
): Promise<ExecutedTool> {
  const started = Date.now();

  const fail = (
    status: ToolCallRecord["status"],
    message: string
  ): ExecutedTool => ({
    turn: {
      role: "tool_result",
      toolUseId: call.id,
      toolName: call.name,
      content: JSON.stringify({ error: message }),
    },
    record: {
      toolName: call.name,
      input: call.input,
      status,
      errorMessage: message,
      durationMs: Date.now() - started,
    },
  });

  const tool = getTool(call.name);
  if (!tool) {
    return fail("error", `No such tool: '${call.name}'.`);
  }

  try {
    assertCanCallTool(ctx, tool);
  } catch (err) {
    const message =
      err instanceof ToolAuthorizationError
        ? err.message
        : "You are not permitted to use this tool.";
    return fail("denied", message);
  }

  let input: unknown;
  try {
    input = tool.validateInput(call.input);
  } catch (err) {
    const message =
      err instanceof ToolValidationError ? err.message : "Invalid tool input.";
    return fail("error", message);
  }

  try {
    const output = await tool.handler(ctx, input);
    return {
      turn: {
        role: "tool_result",
        toolUseId: call.id,
        toolName: call.name,
        content: JSON.stringify(output),
      },
      record: {
        toolName: call.name,
        input: call.input,
        output,
        status: "ok",
        durationMs: Date.now() - started,
      },
    };
  } catch (err) {
    console.error(`Tool '${call.name}' failed:`, err);
    // The message may carry Firestore detail; tell the model the shape of
    // the failure, not its contents.
    return fail("error", `The '${call.name}' lookup failed and returned no data.`);
  }
}

/**
 * A stable key for "this exact call". Built from the *validated* input, so
 * `{}` and `{"period":"today"}` are recognised as the same request rather
 * than paid for twice.
 */
function callKey(name: string, validatedInput: unknown): string {
  return `${name}:${stableStringify(validatedInput)}`;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      return Object.fromEntries(
        Object.entries(val as Record<string, unknown>).sort(([a], [b]) =>
          a.localeCompare(b)
        )
      );
    }
    return val;
  });
}

function budgetExhausted(call: ProviderToolUse): ExecutedTool {
  return {
    turn: {
      role: "tool_result",
      toolUseId: call.id,
      toolName: call.name,
      content: JSON.stringify({ error: BUDGET_EXHAUSTED_MESSAGE }),
    },
    record: {
      toolName: call.name,
      input: call.input,
      status: "error",
      errorMessage: BUDGET_EXHAUSTED_MESSAGE,
      durationMs: 0,
    },
  };
}

/**
 * Run a tool call, or serve the result of an identical one from earlier in
 * this turn. A model that asks the same question twice — common when it
 * re-reads its own transcript — should not cost two Firestore queries or
 * two entries in the audit trail's worth of work.
 */
async function runOrReuse(
  ctx: ToolContext,
  call: ProviderToolUse,
  completed: Map<string, ExecutedTool>
): Promise<ExecutedTool> {
  const tool = getTool(call.name);
  let key: string | undefined;

  // Only successfully validated calls can be keyed; anything else falls
  // through to executeToolCall, which produces the right error.
  if (tool) {
    try {
      key = callKey(call.name, tool.validateInput(call.input));
    } catch {
      key = undefined;
    }
  }

  if (key) {
    const earlier = completed.get(key);
    if (earlier) {
      return {
        // Same content, but tied to *this* call id so the transcript stays
        // valid — a tool result must answer the call that asked for it.
        turn: { ...earlier.turn, toolUseId: call.id },
        record: { ...earlier.record, durationMs: 0, reusedEarlierResult: true },
      };
    }
  }

  const executed = await executeToolCall(ctx, call);
  if (key && executed.record.status === "ok") completed.set(key, executed);
  return executed;
}

export async function handleTurn(
  ctx: ToolContext,
  userMessage: string
): Promise<AgentResponse> {
  registerReadTools();

  // permissionGuard has already required a hotel by the time we get here.
  const hotelId = ctx.hotelId as string;

  // Ownership first: a conversation belongs to the user who started it, and
  // nothing is read or written until that is established.
  await claimConversation({
    hotelId,
    conversationId: ctx.conversationId,
    userId: ctx.userId,
  });

  await appendMessage({
    hotelId,
    conversationId: ctx.conversationId,
    role: "user",
    content: userMessage,
  });

  // One cache for the whole turn: tools that need the same collection
  // share a single read, and every figure in the reply comes from one
  // consistent snapshot.
  const { reply, toolCalls } = await withRequestCache(() =>
    runTurn(ctx, hotelId, userMessage)
  );

  await appendMessage({
    hotelId,
    conversationId: ctx.conversationId,
    role: "assistant",
    content: reply,
  });

  return { conversationId: ctx.conversationId, reply, toolCalls };
}

async function runTurn(
  ctx: ToolContext,
  hotelId: string,
  userMessage: string
): Promise<{ reply: string; toolCalls: ToolCallRecord[] }> {
  const toolCalls: ToolCallRecord[] = [];

  if (!isProviderConfigured()) {
    return { reply: NOT_CONFIGURED_REPLY, toolCalls };
  }

  const history = await getRecentMessages(hotelId, ctx.conversationId, HISTORY_LIMIT);
  const turns = toProviderTurns(history);

  // The just-appended user message may not be readable yet (its
  // serverTimestamp resolves on write); fall back to it directly so the
  // model always sees the question it is answering.
  if (turns.length === 0 || turns[turns.length - 1]?.role !== "user") {
    turns.push({ role: "user", content: userMessage });
  }

  const tools = listTools();
  // Named for the prompt only, and shares the turn's cache — a failure here
  // costs the hotel's name in one line of context, never the answer.
  const hotelName = await fetchHotelName(hotelId);
  const system = buildSystemPrompt({ ctx, tools, hotelName });
  const schemas = toolSchemas(tools);

  /** Results already produced this turn, keyed by tool + arguments. */
  const completed = new Map<string, ExecutedTool>();
  /** Calls issued in the round currently being executed. */
  const pending = new Set<string>();

  try {
    const provider = getProvider();

    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const response = await provider.generate({
        system,
        messages: turns,
        tools: schemas,
      });

      if (response.stopReason === "refusal") {
        return { reply: REFUSAL_REPLY, toolCalls };
      }

      if (response.toolUses.length === 0) {
        return { reply: response.text || REFUSAL_REPLY, toolCalls };
      }

      turns.push({
        role: "assistant",
        content: response.text,
        toolUses: response.toolUses,
        raw: response.raw,
      });

      // Tool handlers are independent reads; running them together keeps a
      // multi-tool question inside one request budget.
      const executed = await Promise.all(
        response.toolUses.map((call) => {
          if (toolCalls.length + pending.size >= MAX_TOOL_CALLS_PER_TURN) {
            return budgetExhausted(call);
          }
          pending.add(call.id);
          return runOrReuse(ctx, call, completed);
        })
      );
      pending.clear();

      for (const { turn, record } of executed) {
        turns.push(turn);
        toolCalls.push(record);
      }

      await Promise.all(
        executed.map(({ record }) =>
          appendMessage({
            hotelId,
            conversationId: ctx.conversationId,
            role: "tool",
            toolName: record.toolName,
            content: `${record.status}${record.errorMessage ? `: ${record.errorMessage}` : ""}`,
          })
        )
      );
    }

    return { reply: TOOL_LOOP_EXHAUSTED_REPLY, toolCalls };
  } catch (err) {
    if (err instanceof ProviderConfigurationError) {
      console.error("AI provider misconfigured:", err.message);
      return { reply: NOT_CONFIGURED_REPLY, toolCalls };
    }
    if (err instanceof ProviderRequestError) {
      console.error("AI provider request failed:", err.status, err.message);
      return { reply: PROVIDER_FAILED_REPLY, toolCalls };
    }
    throw err;
  }
}
