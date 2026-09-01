/**
 * Input validation for tools.
 *
 * Tool input is the one place model-generated data enters this system, so
 * every field is checked before a handler sees it: unknown values are
 * rejected rather than coerced, and nothing is passed through untyped.
 * Hand-written rather than schema-library-driven — the inputs are small
 * and this keeps the deployed function free of another dependency.
 *
 * Errors are `ToolValidationError`, which the orchestrator returns to the
 * model as a tool error so it can correct itself or tell the user plainly.
 */
import { ToolValidationError } from "../types";
import {
  customRange,
  getRange,
  type DatePreset,
  type DateRange,
} from "../../../src/lib/metrics";

export function asObject(raw: unknown): Record<string, unknown> {
  if (raw === null || raw === undefined) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new ToolValidationError("Input must be an object.");
  }
  return raw as Record<string, unknown>;
}

export function optionalEnum<T extends string>(
  input: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  fallback: T
): T {
  const value = input[key];
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new ToolValidationError(
      `'${key}' must be one of: ${allowed.join(", ")}.`
    );
  }
  return value as T;
}

export function optionalString(
  input: Record<string, unknown>,
  key: string,
  maxLength = 100
): string | undefined {
  const value = input[key];
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new ToolValidationError(`'${key}' must be a string.`);
  }
  if (value.length > maxLength) {
    throw new ToolValidationError(`'${key}' is too long.`);
  }
  return value;
}

export function optionalInt(
  input: Record<string, unknown>,
  key: string,
  { min, max, fallback }: { min: number; max: number; fallback: number }
): number {
  const value = input[key];
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new ToolValidationError(
      `'${key}' must be a whole number between ${min} and ${max}.`
    );
  }
  return parsed;
}

/** A calendar date, YYYY-MM-DD, interpreted in the server's local zone. */
export function optionalDate(
  input: Record<string, unknown>,
  key: string
): Date | undefined {
  const value = input[key];
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ToolValidationError(`'${key}' must be a date as YYYY-MM-DD.`);
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime()) || date.getMonth() !== month - 1) {
    throw new ToolValidationError(`'${key}' is not a real date.`);
  }
  return date;
}

export const PERIODS = ["today", "week", "month", "lastMonth", "all"] as const;
export type Period = (typeof PERIODS)[number];

/**
 * The JSON Schema fragment every period-based tool shares, so the model
 * sees one consistent way to ask for a time window.
 */
export const PERIOD_SCHEMA_PROPERTIES = {
  period: {
    type: "string",
    enum: [...PERIODS],
    description:
      "Named period to report on. Ignored when startDate/endDate are given. Defaults to 'today'.",
  },
  startDate: {
    type: "string",
    description:
      "Start of a custom range, YYYY-MM-DD. Must be used together with endDate.",
  },
  endDate: {
    type: "string",
    description: "End of a custom range (inclusive), YYYY-MM-DD.",
  },
} as const;

export interface PeriodInput {
  range: DateRange;
}

/**
 * Resolve a period argument into the same `DateRange` the dashboards use
 * (`getRange`/`customRange` in metrics.ts), so an answer about "this week"
 * covers exactly the week the Overview page shows.
 */
export function parsePeriod(raw: unknown): PeriodInput {
  const input = asObject(raw);
  const startDate = optionalDate(input, "startDate");
  const endDate = optionalDate(input, "endDate");

  if (startDate && !endDate) {
    throw new ToolValidationError("'endDate' is required when 'startDate' is given.");
  }
  if (endDate && !startDate) {
    throw new ToolValidationError("'startDate' is required when 'endDate' is given.");
  }
  if (startDate && endDate) {
    if (endDate < startDate) {
      throw new ToolValidationError("'endDate' cannot be before 'startDate'.");
    }
    return { range: customRange(startDate, endDate) };
  }

  const period = optionalEnum(input, "period", PERIODS, "today");
  return { range: getRange(period as DatePreset) };
}
