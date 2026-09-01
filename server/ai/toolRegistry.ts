/**
 * Tool Registry.
 *
 * Empty by design in Phase 2 — Phase 4 registers the read-only tools
 * (get_occupancy, get_revenue, etc.) here, and Phase 10 adds write tools.
 * The Orchestrator only ever calls tools through this registry, never
 * ad hoc, so every tool is guaranteed to have gone through
 * `assertCanCallTool` first.
 */
import type { RegisteredTool } from "./types";

const registry = new Map<string, RegisteredTool>();

export function registerTool(tool: RegisteredTool): void {
  if (registry.has(tool.name)) {
    throw new Error(`Tool '${tool.name}' is already registered.`);
  }
  registry.set(tool.name, tool);
}

export function getTool(name: string): RegisteredTool | undefined {
  return registry.get(name);
}

export function listTools(): RegisteredTool[] {
  return Array.from(registry.values());
}
