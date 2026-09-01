/**
 * Tool execution.
 *
 * The single path from "the model asked for a tool" to "a tool ran". Every
 * call goes through the same four gates, in this order, and a failure at
 * any gate is terminal for that call — never a fallback to unrestricted
 * access or an invented result:
 *
 *   1. the tool exists in the registry (an unknown name is not executed);
 *   2. the Permission Guard allows this ToolContext to call it;
 *   3. the tool's own validator accepts the model's arguments;
 *   4. write tools are refused here until Phase 10 wires the Confirmation
 *      Manager — a write must never execute on the model's say-so.
 *
 * The outcome is a ToolCallRecord either way, so a denial or a validation
 * error is reported to the model as a failed tool (which the system prompt
 * requires it to report honestly) rather than silently dropped.
 */
import { logger } from "firebase-functions";
import { getTool } from "./toolRegistry";
import { assertCanCallTool } from "./permissionGuard";
import {
  ToolAuthorizationError,
  ToolValidationError,
  type ToolCallRecord,
  type ToolContext,
  type AnyToolDefinition,
  type ToolDeps,
} from "./types";

/** Tools this context is allowed to call — used for the prompt and schemas. */
export function toolsFor(ctx: ToolContext, tools: AnyToolDefinition[]): AnyToolDefinition[] {
  return tools.filter((tool) => {
    try {
      assertCanCallTool(ctx, tool);
      return true;
    } catch {
      return false;
    }
  });
}

export async function executeTool(
  ctx: ToolContext,
  deps: ToolDeps,
  toolName: string,
  rawInput: unknown
): Promise<ToolCallRecord> {
  const startedAt = Date.now();
  const base = { toolName, input: rawInput };

  const tool = getTool(toolName);
  if (!tool) {
    return {
      ...base,
      status: "error",
      errorMessage: `No such tool: '${toolName}'.`,
      durationMs: Date.now() - startedAt,
    };
  }

  try {
    assertCanCallTool(ctx, tool);
  } catch (error) {
    logger.warn("ai.tool.denied", {
      toolName,
      role: ctx.role,
      conversationId: ctx.conversationId,
    });
    return {
      ...base,
      status: "denied",
      errorMessage:
        error instanceof ToolAuthorizationError ? error.message : "Not permitted.",
      durationMs: Date.now() - startedAt,
    };
  }

  if (tool.isWrite) {
    // Defence in depth: no write tools are registered yet, and none may run
    // through this path even when they are (Phase 10 adds the confirmed path).
    return {
      ...base,
      status: "confirmation_required",
      errorMessage: "Write actions require confirmation, which is not available yet.",
      durationMs: Date.now() - startedAt,
    };
  }

  let input: unknown;
  try {
    input = tool.validateInput(rawInput);
  } catch (error) {
    return {
      ...base,
      status: "error",
      errorMessage:
        error instanceof ToolValidationError
          ? error.message
          : "Invalid input for this tool.",
      durationMs: Date.now() - startedAt,
    };
  }

  try {
    const output = await tool.handler(ctx, input, deps);
    const durationMs = Date.now() - startedAt;
    logger.info("ai.tool.completed", {
      toolName,
      conversationId: ctx.conversationId,
      durationMs,
    });
    return { ...base, input, output, status: "ok", durationMs };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    logger.error("ai.tool.failed", {
      toolName,
      conversationId: ctx.conversationId,
      durationMs,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      ...base,
      input,
      status: "error",
      // The model is told the tool failed, never given a substitute value.
      errorMessage: "This tool failed to retrieve data.",
      durationMs,
    };
  }
}
