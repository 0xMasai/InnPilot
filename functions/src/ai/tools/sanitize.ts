/**
 * Free-text sanitisation for values that came out of the database.
 *
 * Guest names, expense departments, menu categories and the like are typed
 * by hotel staff and, in some flows, by guests. They end up inside tool
 * results, which are placed into the model's context — so they are exactly
 * the channel a prompt-injection attempt would travel through.
 *
 * The system prompt already instructs the model to treat record text as
 * data, never instructions. This is the mechanical half of that defence,
 * and it does not depend on the model complying:
 *
 *   - control characters are stripped, so text cannot fake message
 *     structure, line-break framing, or terminal control sequences;
 *   - length is capped, so one hostile record cannot flood the context
 *     window or push real data out of it;
 *   - truncation is marked, so the model is never shown a silently
 *     shortened value as if it were complete.
 *
 * Sanitisation never touches a number or a status — only free text.
 */

/** Longest free-text value copied from a record into a tool result. */
export const MAX_TEXT_LENGTH = 120;

/**
 * C0 controls, DEL, and C1 controls. None of these belong in a guest name
 * or a department label, and all of them can be used to fake structure in
 * the text the model reads.
 */
// Matching control characters is the entire point of this module, so the
// no-control-regex rule is disabled here deliberately, not by oversight.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/g;

/**
 * @returns cleaned text, or null when the value is absent or becomes empty
 *   once cleaned.
 *
 * Finite numbers are accepted and stringified: room numbers in particular
 * are stored as strings in some records and numbers in others, and dropping
 * the numeric ones would lose real data rather than sanitise it.
 */
export function cleanText(value: unknown): string | null {
  const text =
    typeof value === "string"
      ? value
      : typeof value === "number" && Number.isFinite(value)
        ? String(value)
        : null;
  if (text === null) return null;

  const stripped = text.replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim();
  if (!stripped) return null;

  return stripped.length > MAX_TEXT_LENGTH
    ? `${stripped.slice(0, MAX_TEXT_LENGTH)}\u2026 [truncated]`
    : stripped;
}

/** Same, but for grouping keys that need a stable fallback label. */
export function cleanLabel(value: unknown, fallback: string): string {
  return cleanText(value) ?? fallback;
}
