/**
 * Shared tool input schemas and validators.
 *
 * Every tool argument comes from the model, which means it is untrusted
 * input: it may be missing, the wrong type, a hostile string, or a period
 * nobody defined. Validators here reject rather than coerce, and throw
 * ToolValidationError so the Orchestrator can report a tool error honestly
 * instead of the model receiving a silently-defaulted answer.
 *
 * Date ranges are always resolved through `getRange`/`customRange` from
 * `src/lib/metrics.ts` — the same helpers the dashboards' period pickers
 * use — so "this week" means for the AI exactly what it means on screen
 * (Monday-based, end-exclusive).
 */
import {
  customRange,
  getRange,
  type DateRange,
  type DatePreset,
} from "../../../../src/lib/metrics";
import { ToolValidationError } from "../types";

/**
 * Presets the model may ask for. "today"/"week"/"month"/"lastMonth"/"all"
 * map straight onto the app's own DatePreset; "yesterday" is built from
 * customRange because the UI has no such button but managers ask for it
 * constantly.
 */
export const PERIODS = ["today", "yesterday", "week", "month", "lastMonth", "all"] as const;
export type Period = (typeof PERIODS)[number];

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface PeriodInput {
  period?: Period;
  startDate?: string;
  endDate?: string;
}

/** JSON Schema fragment shared by every period-based tool. */
export const PERIOD_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    period: {
      type: "string",
      enum: [...PERIODS],
      description:
        "Named period to report on. Defaults to 'today'. Ignored when startDate/endDate are given.",
    },
    startDate: {
      type: "string",
      description: "Start of a custom range, YYYY-MM-DD (inclusive). Requires endDate.",
    },
    endDate: {
      type: "string",
      description: "End of a custom range, YYYY-MM-DD (inclusive). Requires startDate.",
    },
  },
  required: [],
  additionalProperties: false,
};

/** Shared by every tool taking a single anchor day. */
export const DAY_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    date: {
      type: "string",
      description: "Day to look at, YYYY-MM-DD. Defaults to today.",
    },
  },
  required: [],
  additionalProperties: false,
};

export interface DayInput {
  date?: string;
}

export const EMPTY_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {},
  required: [],
  additionalProperties: false,
};

function asObject(raw: unknown): Record<string, unknown> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new ToolValidationError("Tool input must be an object.");
  }
  return raw as Record<string, unknown>;
}

function rejectUnknownKeys(input: Record<string, unknown>, allowed: string[]): void {
  const unknown = Object.keys(input).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new ToolValidationError(
      `Unknown parameter(s): ${unknown.join(", ")}. Allowed: ${allowed.join(", ") || "(none)"}.`
    );
  }
}

/**
 * Validates a YYYY-MM-DD string. The round-trip check matters: `new Date(2026,
 * 12, 45)` does not throw, it rolls over to 2027-02-14 — so a pattern match
 * alone would let "2026-13-45" through as a silently different range.
 */
export function optionalIsoDate(
  input: Record<string, unknown>,
  key: string
): string | undefined {
  const value = input[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) {
    throw new ToolValidationError(`'${key}' must be a date string in YYYY-MM-DD form.`);
  }

  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(year, month - 1, day);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    throw new ToolValidationError(`'${key}' is not a real calendar date.`);
  }
  return value;
}

/** Parses YYYY-MM-DD as local midnight (getRange/customRange are local-time). */
export function parseIsoDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function validateDayInput(raw: unknown): DayInput {
  const input = asObject(raw);
  rejectUnknownKeys(input, ["date"]);
  return { date: optionalIsoDate(input, "date") };
}

/** Resolves a DayInput to the day it names, defaulting to today. */
export function resolveDay(input: DayInput, now: Date): Date {
  return input.date ? parseIsoDate(input.date) : now;
}

export function validateNoInput(raw: unknown): Record<string, never> {
  rejectUnknownKeys(asObject(raw), []);
  return {};
}

export function validatePeriodInput(raw: unknown): PeriodInput {
  const input = asObject(raw);
  rejectUnknownKeys(input, ["period", "startDate", "endDate"]);

  const startDate = optionalIsoDate(input, "startDate");
  const endDate = optionalIsoDate(input, "endDate");
  if ((startDate === undefined) !== (endDate === undefined)) {
    throw new ToolValidationError("startDate and endDate must be provided together.");
  }
  if (startDate && endDate && parseIsoDate(startDate) > parseIsoDate(endDate)) {
    throw new ToolValidationError("startDate must not be after endDate.");
  }

  const period = input.period;
  if (period !== undefined) {
    if (typeof period !== "string" || !PERIODS.includes(period as Period)) {
      throw new ToolValidationError(
        `'period' must be one of: ${PERIODS.join(", ")}.`
      );
    }
  }

  return { period: period as Period | undefined, startDate, endDate };
}

/**
 * Resolves validated input to a concrete range, using the app's own range
 * helpers so AI periods and dashboard periods cannot drift apart.
 */
export function resolveRange(input: PeriodInput, now: Date): DateRange {
  if (input.startDate && input.endDate) {
    return customRange(parseIsoDate(input.startDate), parseIsoDate(input.endDate));
  }

  if (input.period === "yesterday") {
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const range = customRange(yesterday, yesterday);
    return { ...range, label: "Yesterday" };
  }

  return getRange((input.period ?? "today") as DatePreset, now);
}

/** Serializable description of a range, so every result states its window. */
export function describeRange(range: DateRange): {
  label: string;
  start: string;
  endExclusive: string;
} {
  return {
    label: range.label,
    start: range.start.toISOString(),
    endExclusive: range.end.toISOString(),
  };
}
