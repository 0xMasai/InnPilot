/**
 * InnPilot AI Agent — Cloud Functions entry point.
 *
 * This package's scope is strictly the AI agent (gateway, tools,
 * permission guard, confirmation, conversation, audit) per
 * docs/ai/PHASE_1_PLAN.md. No other InnPilot backend functionality should
 * be added here without a deliberate decision to widen that scope.
 */
export { aiChat } from "./ai/gateway";
