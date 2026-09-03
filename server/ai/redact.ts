/**
 * Redaction for the AI audit trail.
 *
 * The trail has to answer "what did the agent do" without becoming a copy
 * of what the agent *saw*. Tool results carry guest names, and tool inputs
 * carry whatever the model decided to type — a guest's name when it is
 * resolving "check in Sarah", or anything at all when someone is probing
 * the assistant. Neither is safe to store verbatim in a collection that
 * exists to be read later by people investigating an incident.
 *
 * Two rules, both deliberately blunt:
 *
 *   1. **Inputs are an allowlist, not a deny-list.** Only keys named here
 *      are stored; every other key keeps its name and loses its value. A
 *      tool added later with a `guestName` argument is redacted by default
 *      rather than by remembering to add it to a list of bad words — the
 *      failure mode of a deny-list is silent, and this one is not.
 *   2. **Results are recorded as shape, never as content.** How many rooms
 *      came back, not which. What the agent actually changed is recorded
 *      separately and exactly, from the tool's own `audit()`, using stable
 *      identifiers rather than names.
 *
 * `tests/ai/auditLogging.test.ts` pins the allowlist against every
 * registered tool's schema, so adding a tool argument is a decision
 * someone has to make on purpose.
 */
import { createHash } from "node:crypto";

export const REDACTED = "[redacted]";

/**
 * Tool arguments whose values are safe to store: enums, dates, counts and
 * a room number. Nothing here is a free-text field a person's name could
 * arrive in.
 *
 * `reservation` is the notable absence — `update_reservation_status` takes
 * a booking reference *or* a guest name, and there is no way to tell which
 * one the model sent. It is masked, and the reservation that actually
 * changed is recorded from the resolved document instead.
 */
export const AUDIT_SAFE_INPUT_KEYS: ReadonlySet<string> = new Set([
  "period",
  "startDate",
  "endDate",
  "date",
  "window",
  "limit",
  "filter",
  "roomNumber",
  "status",
]);

/** Caps, so one absurd model argument cannot bloat an audit document. */
const MAX_KEYS = 20;
const MAX_KEY_LENGTH = 40;
const MAX_VALUE_LENGTH = 60;
const MAX_ARRAY_ITEMS = 10;

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

/** A value that is safe to keep once its key has been allowlisted. */
function safeValue(value: unknown): unknown {
  if (value === null) return null;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return truncate(value, MAX_VALUE_LENGTH);
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map((item) => safeValue(item));
  }
  // Objects under a safe key are not something any current tool takes; the
  // shape is recorded rather than trusted.
  return REDACTED;
}

/**
 * The arguments the model sent, reduced to what is safe to keep.
 *
 * Takes the *raw* model input rather than the validated one on purpose:
 * an audit trail should show what was asked for, including the malformed
 * and the rejected, not a tidied-up version that passed validation.
 */
export function redactToolInput(raw: unknown): Record<string, unknown> {
  if (raw === null || raw === undefined) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { unexpectedInput: describeType(raw) };
  }

  const out: Record<string, unknown> = {};
  const entries = Object.entries(raw as Record<string, unknown>);

  for (const [key, value] of entries.slice(0, MAX_KEYS)) {
    const name = truncate(key, MAX_KEY_LENGTH);
    out[name] = AUDIT_SAFE_INPUT_KEYS.has(key) ? safeValue(value) : REDACTED;
  }

  if (entries.length > MAX_KEYS) out.truncatedKeys = entries.length - MAX_KEYS;
  return out;
}

/**
 * What a tool returned, as shape only: `{ rooms: "array(12)", total:
 * "number" }`. Enough to see that a question was answered from data and
 * how much of it, with none of the data.
 */
export function describeResultShape(output: unknown): Record<string, string> | null {
  if (output === null || output === undefined) return null;
  if (typeof output !== "object" || Array.isArray(output)) {
    return { result: describeType(output) };
  }

  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(output as Record<string, unknown>).slice(0, MAX_KEYS)) {
    out[truncate(key, MAX_KEY_LENGTH)] = describeType(value);
  }
  return out;
}

function describeType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `array(${value.length})`;
  if (value instanceof Date) return "date";
  return typeof value;
}

/**
 * A short, non-reversible handle for a confirmation id.
 *
 * The audit trail needs to link "a change was proposed" to "that change
 * was executed", and the confirmation id is the only thing common to both.
 * Storing the id itself would put a live capability token — briefly, one
 * that authorises a write — into a collection people read. The fingerprint
 * correlates the two rows and authorises nothing.
 */
export function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}
