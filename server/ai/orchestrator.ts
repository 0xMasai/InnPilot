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
 * Phase 10 adds writes, and they do not run here. A write the model asks
 * for becomes a pending action the user must approve; a later request
 * carrying the confirmation id this server issued is what executes it. The
 * model proposes, and never performs.
 *
 * Phase 12 adds the audit trail. Every call the model makes — answered,
 * refused, proposed or executed — is recorded before the turn returns, and
 * an executed write is additionally recorded in the operational audit log
 * the rest of InnPilot writes to. See `auditLogger.ts`.
 *
 * Still deliberately absent: structured logs (Phase 13).
 *
 * The honesty rule from the brief governs every failure path: if a tool
 * fails, the model is told it failed and must say so. Nothing here lets an
 * unanswerable question become an invented answer.
 */
import type {
  AgentResponse,
  AiAuditTarget,
  ToolCallRecord,
  ToolContext,
  ToolFailureKind,
  RegisteredTool,
} from "./types";
import { ToolAuthorizationError, ToolValidationError } from "./types";
import {
  appendMessage,
  claimConversation,
  getRecentMessages,
} from "./conversationManager";
import { getTool, listTools } from "./toolRegistry";
import { consumePendingAction, createPendingAction } from "./confirmationManager";
import { registerTools } from "./tools";
import { buildSystemPrompt } from "./systemPrompt";
import { fetchHotelName } from "./tools/dataAccess";
import { assertCanCallTool } from "./permissionGuard";
import { recordAiActions } from "./auditLogger";
import type { AiAuditEvent, ConfirmationStatus } from "./auditLogger";
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
  /**
   * Set when this call was a write proposal rather than an execution. The
   * turn carries at most one — see `proposeWrite`.
   */
  proposed?: NonNullable<AgentResponse["pendingConfirmation"]>;
}

/**
 * Run one tool call the model asked for. Never throws: a failure becomes a
 * result the model can read and report honestly, which is the whole point
 * — a thrown error would leave the user with a generic apology instead of
 * "I couldn't read the expenses".
 */
async function executeToolCall(
  ctx: ToolContext,
  call: ProviderToolUse,
  /** Whether a write has already been proposed this turn — see `proposeWrite`. */
  writeAlreadyProposed: boolean
): Promise<ExecutedTool> {
  const started = Date.now();

  const fail = (
    status: ToolCallRecord["status"],
    kind: ToolFailureKind,
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
      errorKind: kind,
      durationMs: Date.now() - started,
    },
  });

  const tool = getTool(call.name);
  if (!tool) {
    return fail("error", "unknown_tool", `No such tool: '${call.name}'.`);
  }

  try {
    assertCanCallTool(ctx, tool);
  } catch (err) {
    const message =
      err instanceof ToolAuthorizationError
        ? err.message
        : "You are not permitted to use this tool.";
    return fail("denied", "not_permitted", message);
  }

  let input: unknown;
  try {
    input = tool.validateInput(call.input);
  } catch (err) {
    const message =
      err instanceof ToolValidationError ? err.message : "Invalid tool input.";
    return fail("error", "invalid_input", message);
  }

  // A write is proposed, never executed here. The model asking for one is
  // not authority to perform it; the user's confirmation, verified server
  // side against a pending action, is. See `proposeWrite`.
  if (tool.isWrite) {
    return proposeWrite({ ctx, call, tool, input, started, writeAlreadyProposed });
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
    return fail(
      "error",
      "handler_failed",
      `The '${call.name}' lookup failed and returned no data.`
    );
  }
}

/**
 * Turn a write the model asked for into a pending action the user must
 * approve. Nothing is written here.
 *
 * The separation is the point of the phase. The model proposes; the
 * Confirmation Manager issues an id bound to this hotel, user,
 * conversation, tool and input; the user approves; a *later* request
 * consumes that id and runs the tool. A model that decides on its own that
 * confirmation happened has changed nothing, because it never held the
 * capability to write in the first place.
 *
 * `summarize` runs first and may refuse — an unresolvable room number or
 * an ambiguous guest name comes back as a tool error the model can relay,
 * and no pending action is created for a change nobody could describe.
 */
async function proposeWrite(params: {
  ctx: ToolContext;
  call: ProviderToolUse;
  tool: RegisteredTool;
  input: unknown;
  started: number;
  writeAlreadyProposed: boolean;
}): Promise<ExecutedTool> {
  const { ctx, call, tool, input, started } = params;

  const result = (
    content: Record<string, unknown>,
    record: Partial<ToolCallRecord> & Pick<ToolCallRecord, "status">
  ): ExecutedTool => ({
    turn: {
      role: "tool_result",
      toolUseId: call.id,
      toolName: call.name,
      content: JSON.stringify(content),
    },
    record: {
      toolName: call.name,
      input: call.input,
      durationMs: Date.now() - started,
      ...record,
    },
  });

  // One pending action per turn. `AgentResponse` carries a single
  // `pendingConfirmation`, and a user approving one button while a second
  // change waits unseen is exactly the confusion confirmation exists to
  // prevent. The model is told to do them one at a time.
  if (params.writeAlreadyProposed) {
    const message =
      "Another change is already awaiting the user's confirmation. Ask for one change at a time: " +
      "tell the user about the pending one, and raise this after they answer.";
    return result(
      { error: message },
      { status: "error", errorMessage: message, errorKind: "second_write_in_turn" }
    );
  }

  // A write tool with no `summarize` cannot describe what it would do, so
  // there is nothing for a user to approve. Failing closed here means a
  // tool added without one is inert rather than silently unconfirmed.
  if (!tool.summarize) {
    console.error(`Write tool '${tool.name}' has no summarize(); refusing to propose it.`);
    const message = `The '${call.name}' action is not available.`;
    return result(
      { error: message },
      { status: "error", errorMessage: message, errorKind: "not_confirmable" }
    );
  }

  let summary: string;
  try {
    summary = await tool.summarize(ctx, input);
  } catch (err) {
    // A validation refusal is meant for the model to read and relay ("no
    // room 204"), so its message goes through. Anything else may carry
    // Firestore detail and does not.
    const message =
      err instanceof ToolValidationError
        ? err.message
        : `Could not work out what '${call.name}' would change.`;
    if (!(err instanceof ToolValidationError)) {
      console.error(`Write tool '${call.name}' failed to summarize:`, err);
    }
    return result(
      { error: message },
      {
        status: "error",
        errorMessage: message,
        errorKind:
          err instanceof ToolValidationError ? "target_unresolved" : "summary_failed",
      }
    );
  }

  const confirmationId = await createPendingAction({
    hotelId: ctx.hotelId as string,
    userId: ctx.userId,
    conversationId: ctx.conversationId,
    toolName: tool.name,
    // The validated input, not what the model sent: this is what will be
    // executed on confirmation, so it is what must be stored.
    input,
    summary,
  });

  return {
    ...result(
      {
        status: "confirmation_required",
        summary,
        // Deliberately not the confirmation id. The model has no use for
        // it — the user's client holds it — and a value in the transcript
        // is a value that can be echoed back into one.
        instruction:
          "Nothing has changed yet. Tell the user exactly what you are about to do, in one " +
          "sentence, and ask them to confirm. Do not claim it is done.",
      },
      { status: "confirmation_required" }
    ),
    proposed: { confirmationId, toolName: tool.name, summary },
  };
}

/**
 * Execute a write the user has confirmed.
 *
 * Called only after `consumePendingAction` has atomically verified and
 * spent the id. The tool and its arguments come from the stored action —
 * never from the request that carried the confirmation — so approving one
 * change cannot be redirected into performing another.
 *
 * The role is re-checked here rather than trusted from proposal time: a
 * user demoted in the five minutes between proposing and confirming must
 * not get the write through on the strength of the earlier check.
 */
async function executeConfirmed(
  ctx: ToolContext,
  action: { toolName: string; input: unknown }
): Promise<ConfirmedWrite> {
  const started = Date.now();
  const tool = getTool(action.toolName);

  const failed = (kind: ToolFailureKind, message: string): ConfirmedWrite => ({
    reply: message,
    record: {
      toolName: action.toolName,
      input: action.input,
      status: "error",
      errorMessage: message,
      errorKind: kind,
      durationMs: Date.now() - started,
    },
  });

  if (!tool || !tool.isWrite) {
    return failed("unknown_tool", "That action is no longer available, so nothing was changed.");
  }

  try {
    assertCanCallTool(ctx, tool);
  } catch (err) {
    const message =
      err instanceof ToolAuthorizationError
        ? err.message
        : "You are not permitted to make this change.";
    return {
      reply: `${message} Nothing was changed.`,
      record: {
        toolName: action.toolName,
        input: action.input,
        status: "denied",
        errorMessage: message,
        errorKind: "not_permitted",
        durationMs: Date.now() - started,
      },
    };
  }

  try {
    const output = await tool.handler(ctx, action.input);
    return {
      // Built from the tool's own result, not written by the model. The
      // model is not consulted on this turn at all, so it has no way to
      // report a success that did not happen.
      reply: describeWriteResult(output),
      record: {
        toolName: action.toolName,
        input: action.input,
        output,
        status: "ok",
        durationMs: Date.now() - started,
      },
      target: auditTarget(tool, action.input, output),
    };
  } catch (err) {
    console.error(`Confirmed write '${action.toolName}' failed:`, err);
    return failed(
      "handler_failed",
      "That change could not be saved, so nothing was changed. Please try again."
    );
  }
}

/** What executing a confirmed write produced: the reply, and the trail. */
interface ConfirmedWrite {
  reply: string;
  record: ToolCallRecord;
  target?: AiAuditTarget;
}

/**
 * Ask the tool to describe what it changed, for the operational audit log.
 *
 * A tool that throws here has still made its change, and the user must
 * still be told so — the write is done and cannot be un-done by a logging
 * problem. The row is lost, loudly, rather than the reply being turned
 * into a failure that did not happen.
 */
function auditTarget(
  tool: RegisteredTool,
  input: unknown,
  output: unknown
): AiAuditTarget | undefined {
  if (!tool.audit) return undefined;
  try {
    return tool.audit(input, output);
  } catch (err) {
    console.error(`Write tool '${tool.name}' failed to describe its audit entry:`, err);
    return undefined;
  }
}

/**
 * One tool call, as the audit trail records it.
 *
 * Built from the same `ToolCallRecord` the UI is shown, so the trail and
 * the user's view of "what the assistant did" cannot disagree. What the
 * record does *not* carry into storage — the arguments' free text, the
 * output's content, the error prose — is `redact.ts`'s decision, made in
 * one place rather than at each call site.
 */
function auditEventFor(
  record: ToolCallRecord,
  extras: {
    confirmationStatus: ConfirmationStatus;
    confirmationId?: string;
    target?: AiAuditTarget;
  }
): AiAuditEvent {
  const tool = getTool(record.toolName);
  return {
    actionType: tool ? (tool.isWrite ? "write" : "read") : "unknown",
    toolName: record.toolName,
    input: record.input,
    output: record.output,
    status: record.status,
    errorKind: record.errorKind,
    durationMs: record.durationMs,
    reusedEarlierResult: record.reusedEarlierResult,
    ...extras,
  };
}

/** Plain-language outcome of a confirmed write, from the tool's own output. */
function describeWriteResult(output: unknown): string {
  const result = (output ?? {}) as Record<string, unknown>;

  if (result.changed === false) {
    return typeof result.note === "string"
      ? `No change was needed: ${result.note}`
      : "No change was needed; the record was already in that state.";
  }

  if (typeof result.roomNumber === "string") {
    return `Done — room ${result.roomNumber} is now '${String(result.status)}'.`;
  }
  if (typeof result.reservation === "string") {
    return `Done — the reservation for ${result.reservation} is now '${String(result.status)}'.`;
  }
  return "Done — the change has been saved.";
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
      errorKind: "budget_exhausted",
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
  completed: Map<string, ExecutedTool>,
  writeAlreadyProposed: boolean
): Promise<ExecutedTool> {
  const tool = getTool(call.name);
  let key: string | undefined;

  // Only successfully validated calls can be keyed; anything else falls
  // through to executeToolCall, which produces the right error. Write
  // tools are never keyed: reuse exists to avoid paying twice for the same
  // read, and a write is not a value to be served from a cache.
  if (tool && !tool.isWrite) {
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

  const executed = await executeToolCall(ctx, call, writeAlreadyProposed);
  if (key && executed.record.status === "ok") completed.set(key, executed);
  return executed;
}

export async function handleTurn(
  ctx: ToolContext,
  userMessage: string,
  /**
   * Present when the user is answering a confirmation. It is an id this
   * server issued, not a claim by the model that approval happened.
   */
  confirmationId?: string
): Promise<AgentResponse> {
  registerTools();

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

  if (confirmationId) {
    const outcome = await handleConfirmation(ctx, hotelId, confirmationId);
    await appendMessage({
      hotelId,
      conversationId: ctx.conversationId,
      role: "assistant",
      content: outcome.reply,
    });
    return { conversationId: ctx.conversationId, ...outcome };
  }

  // One cache for the whole turn: tools that need the same collection
  // share a single read, and every figure in the reply comes from one
  // consistent snapshot.
  const { reply, toolCalls, pendingConfirmation } = await withRequestCache(() =>
    runTurn(ctx, hotelId, userMessage)
  );

  await appendMessage({
    hotelId,
    conversationId: ctx.conversationId,
    role: "assistant",
    content: reply,
  });

  return { conversationId: ctx.conversationId, reply, toolCalls, pendingConfirmation };
}

/**
 * The confirming half of a write.
 *
 * No provider call happens here, by design. The reply is built from the
 * tool's own result, so the sentence a user reads is generated by the code
 * that performed the change rather than by a model asked to describe it —
 * and "done" cannot be said about a write that failed.
 *
 * Deliberately outside `withRequestCache`: the write must read the record
 * as it is now, not through a snapshot held for consistency.
 */
async function handleConfirmation(
  ctx: ToolContext,
  hotelId: string,
  confirmationId: string
): Promise<{ reply: string; toolCalls: ToolCallRecord[] }> {
  const action = await consumePendingAction({
    hotelId,
    userId: ctx.userId,
    conversationId: ctx.conversationId,
    confirmationId,
  });

  // One answer for every way an id can fail — wrong user, wrong
  // conversation, expired, already used, never existed. Distinguishing
  // them would tell a caller probing ids which of their guesses was close.
  //
  // The trail does not have to be as discreet as the reply: a refused
  // confirmation is exactly the event someone reviewing an incident needs
  // to see, so it is recorded even though no tool ran and the server does
  // not know which one was meant.
  if (!action) {
    await recordAiActions(ctx, [
      {
        actionType: "write",
        toolName: null,
        input: null,
        status: "denied",
        errorKind: "confirmation_invalid",
        confirmationStatus: "rejected",
        confirmationId,
        durationMs: 0,
      },
    ]);
    return {
      reply:
        "That confirmation is no longer valid — it may have expired, or already been used. " +
        "Nothing was changed. Ask again if you still want to make the change.",
      toolCalls: [],
    };
  }

  const { reply, record, target } = await executeConfirmed(ctx, action);

  await recordAiActions(ctx, [
    auditEventFor(record, { confirmationStatus: "confirmed", confirmationId, target }),
  ]);

  return { reply, toolCalls: [record] };
}

/**
 * Where a call sits in the confirmation flow, at the moment it is logged.
 *
 * A read never needed one. A proposed write is `pending` — and stays that
 * way in the trail if the user never confirms, which is itself worth being
 * able to see. A write that failed before it could be proposed never
 * reached the question.
 */
function confirmationStatusOf(
  record: ToolCallRecord,
  proposed: boolean
): ConfirmationStatus {
  if (proposed) return "pending";
  const tool = getTool(record.toolName);
  return tool?.isWrite ? "not_reached" : "not_required";
}

async function runTurn(
  ctx: ToolContext,
  hotelId: string,
  userMessage: string
): Promise<{
  reply: string;
  toolCalls: ToolCallRecord[];
  pendingConfirmation?: AgentResponse["pendingConfirmation"];
}> {
  const toolCalls: ToolCallRecord[] = [];
  /** The one write awaiting approval, if the model proposed one. */
  let pendingConfirmation: AgentResponse["pendingConfirmation"];

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
        return { reply: REFUSAL_REPLY, toolCalls, pendingConfirmation };
      }

      if (response.toolUses.length === 0) {
        // The usual end of a turn that proposed a write: the model has
        // just written the sentence asking the user to confirm.
        return { reply: response.text || REFUSAL_REPLY, toolCalls, pendingConfirmation };
      }

      turns.push({
        role: "assistant",
        content: response.text,
        toolUses: response.toolUses,
        raw: response.raw,
      });

      // Tool handlers are independent reads; running them together keeps a
      // multi-tool question inside one request budget.
      //
      // `writeClaimed` is decided here, in the synchronous map, rather than
      // inside the concurrent work: two write calls in one batch would
      // otherwise both see "no write proposed yet" and both create a
      // pending action. The first in the model's own order wins.
      let writeClaimed = pendingConfirmation !== undefined;
      const executed = await Promise.all(
        response.toolUses.map((call) => {
          if (toolCalls.length + pending.size >= MAX_TOOL_CALLS_PER_TURN) {
            return budgetExhausted(call);
          }
          pending.add(call.id);
          const isWrite = getTool(call.name)?.isWrite ?? false;
          const alreadyProposed = isWrite && writeClaimed;
          if (isWrite) writeClaimed = true;
          return runOrReuse(ctx, call, completed, alreadyProposed);
        })
      );
      pending.clear();

      for (const { turn, record, proposed } of executed) {
        turns.push(turn);
        toolCalls.push(record);
        if (proposed && !pendingConfirmation) pendingConfirmation = proposed;
      }

      await Promise.all([
        ...executed.map(({ record }) =>
          appendMessage({
            hotelId,
            conversationId: ctx.conversationId,
            role: "tool",
            toolName: record.toolName,
            content: `${record.status}${record.errorMessage ? `: ${record.errorMessage}` : ""}`,
          })
        ),
        // Awaited, not fired and forgotten: on a serverless host the
        // response ends the invocation, and an unawaited write is one that
        // may simply never happen.
        recordAiActions(
          ctx,
          executed.map(({ record, proposed }) =>
            auditEventFor(record, {
              confirmationStatus: confirmationStatusOf(record, proposed !== undefined),
              confirmationId: proposed?.confirmationId,
            })
          )
        ),
      ]);
    }

    return { reply: TOOL_LOOP_EXHAUSTED_REPLY, toolCalls, pendingConfirmation };
  } catch (err) {
    if (err instanceof ProviderConfigurationError) {
      console.error("AI provider misconfigured:", err.message);
      return { reply: NOT_CONFIGURED_REPLY, toolCalls, pendingConfirmation };
    }
    if (err instanceof ProviderRequestError) {
      console.error("AI provider request failed:", err.status, err.message);
      return { reply: PROVIDER_FAILED_REPLY, toolCalls, pendingConfirmation };
    }
    throw err;
  }
}
