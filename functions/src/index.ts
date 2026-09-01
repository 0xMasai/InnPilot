/**
 * InnPilot AI Agent — Cloud Functions entry point.
 *
 * This package's scope is strictly the AI agent (gateway, tools,
 * permission guard, confirmation, conversation, audit) per
 * docs/ai/PHASE_1_PLAN.md. No other InnPilot backend functionality should
 * be added here without a deliberate decision to widen that scope.
 */
import { registerReadTools } from "./ai/tools";

// Populate the Tool Registry at cold start, before any request is served.
// The system prompt renders the registry, so this is also what stops the
// agent from being told about tools that are not actually installed.
registerReadTools();

export { aiChat } from "./ai/gateway";
