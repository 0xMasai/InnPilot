/**
 * Argument readers for WebMCP tools.
 *
 * Agent-supplied input arrives as `Record<string, unknown>`; the browser
 * validates against `inputSchema`, but a tool must not rely on that alone.
 * These helpers narrow types explicitly and raise ToolInputError, whose
 * message the registry hands straight back so the agent can retry with
 * corrected arguments.
 */
import { ToolInputError } from "./types";

export function requireString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new ToolInputError(`"${key}" is required and must be a non-empty string.`);
  }
  return value.trim();
}

export function optionalString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new ToolInputError(`"${key}" must be a string.`);
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Calendar date as YYYY-MM-DD — the format InnPilot's date inputs produce. */
export function requireDate(input: Record<string, unknown>, key: string): string {
  const value = requireString(input, key);
  if (!ISO_DATE.test(value) || Number.isNaN(new Date(`${value}T00:00:00`).getTime())) {
    throw new ToolInputError(`"${key}" must be a calendar date in YYYY-MM-DD format.`);
  }
  return value;
}

export function optionalDate(input: Record<string, unknown>, key: string): string | undefined {
  if (input[key] === undefined || input[key] === null || input[key] === "") return undefined;
  return requireDate(input, key);
}

/** Reads a value constrained to a fixed set, listing the valid options on failure. */
export function requireEnum<T extends string>(
  input: Record<string, unknown>,
  key: string,
  allowed: readonly T[]
): T {
  const value = requireString(input, key);
  const match = allowed.find((option) => option.toLowerCase() === value.toLowerCase());
  if (!match) {
    throw new ToolInputError(`"${key}" must be one of: ${allowed.join(", ")}. Received "${value}".`);
  }
  return match;
}

export function optionalEnum<T extends string>(
  input: Record<string, unknown>,
  key: string,
  allowed: readonly T[]
): T | undefined {
  if (input[key] === undefined || input[key] === null || input[key] === "") return undefined;
  return requireEnum(input, key, allowed);
}

/** Standard success payload: a single text block. */
export function toolText(text: string): WebMCPToolResult {
  return { content: [{ type: "text", text }] };
}

/** Standard failure payload — reported, not thrown, so the agent can recover. */
export function toolError(text: string): WebMCPToolResult {
  return { content: [{ type: "text", text }], isError: true };
}
