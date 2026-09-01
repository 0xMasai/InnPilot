/**
 * Tool definition wrapper — per-tool, independent enforcement.
 *
 * `toolRunner.ts` already checks authorization and validates input before
 * calling a handler. This wrapper makes each tool do the same *for itself*,
 * so a tool is safe no matter how it is reached: a future orchestrator path,
 * a test, a script, or a refactor that forgets the runner. Security that
 * depends on every caller remembering to call the guard is not security.
 *
 * The double check is cheap and safe: `assertCanCallTool` is pure, and every
 * validator is idempotent (validating an already-validated value returns an
 * equal value), which is a property the Phase 5 test suite pins down.
 */
import { assertCanCallTool } from "../permissionGuard";
import type {
  AnyToolDefinition,
  ToolContext,
  ToolDefinition,
  ToolDeps,
} from "../types";

/** Roles that mirror `hotelStaff()` in firestore.rules: admin + staff. */
export const HOTEL_STAFF_ROLES = ["hotel_admin", "staff"] as const;

/**
 * Builds a read-only tool whose handler re-checks authorization and
 * re-validates its input before doing any work.
 */
export function defineReadTool<TInput, TOutput>(
  definition: Omit<ToolDefinition<TInput, TOutput>, "isWrite">
): ToolDefinition<TInput, TOutput> {
  const tool: ToolDefinition<TInput, TOutput> = {
    ...definition,
    isWrite: false,
    async handler(ctx: ToolContext, input: TInput, deps: ToolDeps) {
      // The guard reads only the server-built ToolContext, never `input`, so
      // a tool argument can never widen access.
      assertCanCallTool(ctx, tool as AnyToolDefinition);
      const checked = definition.validateInput(input);
      return definition.handler(ctx, checked, deps);
    },
  };
  return tool;
}
