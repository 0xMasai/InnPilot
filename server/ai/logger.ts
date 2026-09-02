/**
 * Structured logging for the AI gateway (Phase 13).
 *
 * Phase 12 gave the *hotel* an account of what the assistant did, in
 * Firestore, redacted, readable by that hotel's admin. This module gives
 * the *operator* an account of how the gateway behaved: how long a turn
 * took, which round the provider was slow in, how many tools ran, and what
 * failed. Different reader, different trust boundary, different rules —
 * see "What never goes in a log line" below.
 *
 * ## One JSON object per line
 *
 * Every host this can deploy to (Vercel today) collects stdout/stderr and
 * parses a line that is valid JSON into queryable fields. So each event is
 * exactly one `console` call carrying one flat object, never a formatted
 * sentence with values interpolated into it: `event=ai.tool.call
 * status=error` is a filter, `"Tool 'get_revenue' failed"` is a haystack.
 *
 * ## Correlation
 *
 * A request gets an id at the gateway and every line emitted while it runs
 * carries it, via `AsyncLocalStorage` — the same mechanism `requestCache`
 * uses, and for the same reason: threading a logger through eleven call
 * sites would change every signature between here and a tool handler. The
 * id also travels back to the client (`AgentResponse.requestId`, and the
 * body of every error response), so a manager reporting "it said it
 * couldn't reach the AI service" hands over the one string that finds the
 * lines.
 *
 * ## What never goes in a log line
 *
 * The user's message, tool arguments, tool results, guest names, the
 * hotel's figures, the API key. Not because the operator is untrusted —
 * they hold the service account and could read the database directly — but
 * because logs leave the trust boundary the database stays inside: they
 * are shipped to hosting dashboards, drained to third-party aggregators,
 * and kept long after the data they quote was deleted.
 *
 * Everything here is therefore an identifier, an enum, a count, or a
 * duration. Free text appears in exactly one place — `ai.error`, which
 * carries a thrown error's own message — and that is a deliberate
 * exception documented at `logInternalError`.
 *
 * ## Levels
 *
 * `AI_LOG_LEVEL` = debug | info | warn | error | silent (default info;
 * silent under Vitest unless the test sets it, so a suite that exercises
 * the orchestrator does not print a few hundred lines it never asserts).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { InputMode, Role, ToolCallRecord, ToolFailureKind } from "./types";

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

/**
 * How a turn ended. A closed union for the same reason `ToolFailureKind`
 * is one: an outcome is only chartable if its spelling is stable. Anything
 * other than the three in `SUCCESSFUL_OUTCOMES` is a turn the user did not
 * get an answer from, which is the number worth alerting on.
 */
export type RequestOutcome =
  | "answered"
  | "confirmation_pending"
  | "confirmed_write"
  | "confirmation_rejected"
  | "confirmation_failed"
  | "not_configured"
  | "provider_failed"
  | "model_refused"
  | "tool_loop_exhausted"
  | "internal_error"
  | "rejected"
  | "unknown";

/** Outcomes where the user got what they asked for. */
const SUCCESSFUL_OUTCOMES: ReadonlySet<RequestOutcome> = new Set([
  "answered",
  "confirmation_pending",
  "confirmed_write",
]);

/**
 * Why the gateway refused a request before the agent ran.
 *
 * More specific than the message the caller receives, on purpose: "Sign in
 * required" is returned for both a missing token and a forged one, because
 * telling a caller which of their guesses was closer is a favour to
 * whoever is guessing. The log gets to be specific — its reader is the
 * operator.
 */
export type RejectionReason =
  | "unauthenticated"
  | "invalid_token"
  | "invalid_request"
  | "no_hotel"
  | "not_permitted"
  | "unexpected";

/**
 * Where an unexpected failure happened. Named rather than free-form so
 * "the audit write is failing" is a query and not a text search.
 */
export type ErrorScope =
  | "gateway"
  | "http_adapter"
  | "turn"
  | "tool_handler"
  | "write_summarize"
  | "write_audit_describe"
  | "audit_write"
  | "conversation_append";

/** A problem the code handled and continued through; no exception exists. */
export type ProblemKind =
  | "audit_no_hotel"
  | "write_not_confirmable"
  | "invalid_log_level";

interface RequestLogScope {
  requestId: string;
  startedAt: number;
  userId?: string;
  hotelId?: string;
  role?: Role;
  conversationId?: string;
  /** How the client says the message arrived (Phase 14). Default "text". */
  inputMode: InputMode;
  outcome: RequestOutcome;
  toolCalls: number;
  providerCalls: number;
  providerMs: number;
  inputTokens: number;
  outputTokens: number;
  cachedReads: number;
}

const storage = new AsyncLocalStorage<RequestLogScope>();

/** Caps, so no single line can become a paragraph. */
const MAX_MESSAGE = 300;
const MAX_STACK = 800;

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}...`;
}

let levelWarningIssued = false;

function resolveLevel(): LogLevel {
  const raw = process.env.AI_LOG_LEVEL?.trim().toLowerCase();
  if (raw) {
    if (raw in LEVEL_RANK) return raw as LogLevel;
    // Not thrown: a typo in a log setting must not take the assistant
    // down. It is reported once per process, at the default level.
    if (!levelWarningIssued) {
      levelWarningIssued = true;
      logProblem("invalid_log_level", { value: truncate(raw, 20) });
    }
  }
  // Vitest sets this. A test that wants the lines sets AI_LOG_LEVEL itself.
  if (process.env.VITEST) return "silent";
  return "info";
}

type Fields = Record<string, string | number | boolean | null | undefined>;

function emit(level: Exclude<LogLevel, "silent">, event: string, fields: Fields): void {
  if (LEVEL_RANK[level] < LEVEL_RANK[resolveLevel()]) return;

  const scope = storage.getStore();
  const line: Fields = {
    ts: new Date().toISOString(),
    level,
    event,
    requestId: scope?.requestId,
    userId: scope?.userId,
    hotelId: scope?.hotelId,
    role: scope?.role,
    conversationId: scope?.conversationId,
    ...fields,
  };

  // `undefined` disappears in JSON.stringify, so an unresolved field is
  // simply absent rather than logged as the string "undefined".
  const serialized = JSON.stringify(line);

  if (level === "error") console.error(serialized);
  else if (level === "warn") console.warn(serialized);
  else console.log(serialized);
}

/**
 * Run one request inside its own log scope. The generated id is passed to
 * `fn` so the caller can return it to the client.
 */
export function withRequestLog<T>(fn: (requestId: string) => Promise<T>): Promise<T> {
  const scope: RequestLogScope = {
    requestId: newRequestId(),
    startedAt: Date.now(),
    inputMode: "text",
    outcome: "unknown",
    toolCalls: 0,
    providerCalls: 0,
    providerMs: 0,
    inputTokens: 0,
    outputTokens: 0,
    cachedReads: 0,
  };
  return storage.run(scope, () => fn(scope.requestId));
}

/**
 * Short, not a UUID: it gets pasted into a support message and typed into
 * a log search. 12 hex characters is unique enough among the requests one
 * deployment will be asked about at once, and identifies nothing on its own.
 */
function newRequestId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 12);
}

/** The current request's id, or undefined outside a request (a script). */
export function currentRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

/**
 * Attach the caller's identity to every line this request emits from here
 * on, including ones from modules that never see a `ToolContext`.
 *
 * Called twice: once with the uid as soon as the token is verified (so a
 * request that fails validation is still attributable), and again with the
 * full context once the Context Manager has resolved it. Fields not passed
 * are left as they were rather than cleared.
 */
export function noteRequestIdentity(identity: {
  userId?: string;
  hotelId?: string | null;
  role?: Role;
  conversationId?: string;
}): void {
  const scope = storage.getStore();
  if (!scope) return;
  if (identity.userId !== undefined) scope.userId = identity.userId;
  if (identity.hotelId !== undefined) scope.hotelId = identity.hotelId ?? undefined;
  if (identity.role !== undefined) scope.role = identity.role;
  if (identity.conversationId !== undefined) scope.conversationId = identity.conversationId;
}

/**
 * Record how the client says this request arrived (Phase 14).
 *
 * It rides on the request scope rather than being threaded as a parameter,
 * and that is the point rather than a convenience: `handleTurn` never
 * receives it, so no code that decides what the agent does can read it.
 * The two readers that legitimately want it — this module's start/finish
 * lines and the Phase 12 audit row — both already run inside the scope.
 *
 * It is a client assertion, not a verified fact. It is recorded, and
 * nothing is granted on the strength of it.
 */
export function noteInputMode(mode: InputMode): void {
  const scope = storage.getStore();
  if (scope) scope.inputMode = mode;
}

/**
 * The current request's input mode, defaulting to `text` — including
 * outside a request, where a caller (a script) had no mode to declare.
 */
export function currentInputMode(): InputMode {
  return storage.getStore()?.inputMode ?? "text";
}

/**
 * Record how this turn ended. Called at each of the orchestrator's exits,
 * so `ai.request.finish` states the outcome rather than leaving one to be
 * inferred from the absence of an error.
 */
export function noteOutcome(outcome: RequestOutcome): void {
  const scope = storage.getStore();
  if (scope) scope.outcome = outcome;
}

/** How many distinct Firestore reads the turn's cache actually issued. */
export function noteCachedReads(count: number): void {
  const scope = storage.getStore();
  if (scope) scope.cachedReads = count;
}

/**
 * `inputMode` is on this line and on the finish line, not in the prefix
 * every line carries. The prefix holds what makes a line *attributable*
 * when it is the only line — an `ai.error` raised before the start line
 * still needs its user and hotel. Input mode is per-request and constant,
 * so `requestId` joins it onto everything else, and paying for it on all
 * ten lines of a turn buys nothing.
 */
export function logRequestStart(fields: {
  messageLength: number;
  answeringConfirmation: boolean;
}): void {
  emit("info", "ai.request.start", { ...fields, inputMode: currentInputMode() });
}

/**
 * A request the gateway refused, with the specific reason — which the
 * caller's own message deliberately does not distinguish.
 */
export function logRequestRejected(fields: {
  status: number;
  reason: RejectionReason;
}): void {
  noteOutcome("rejected");
  emit("warn", "ai.request.rejected", fields);
}

/**
 * The one line per request carrying the totals: latency split between the
 * provider and everything else, tokens, tool count, and how it ended. `ok`
 * is the field to alert on.
 */
export function logRequestFinish(): void {
  const scope = storage.getStore();
  if (!scope) return;

  const durationMs = Date.now() - scope.startedAt;
  emit("info", "ai.request.finish", {
    inputMode: scope.inputMode,
    outcome: scope.outcome,
    ok: SUCCESSFUL_OUTCOMES.has(scope.outcome),
    durationMs,
    providerMs: scope.providerMs,
    // What the turn spent outside the model: Firestore, tools, our own
    // work. A rise here is our problem; a rise in providerMs is not.
    overheadMs: Math.max(0, durationMs - scope.providerMs),
    providerCalls: scope.providerCalls,
    toolCalls: scope.toolCalls,
    cachedReads: scope.cachedReads,
    inputTokens: scope.inputTokens,
    outputTokens: scope.outputTokens,
  });
}

/** One model round-trip: latency, tokens, and what it asked for next. */
export function logProviderCall(fields: {
  provider: string;
  model: string;
  round: number;
  durationMs: number;
  stopReason: string;
  toolUses: number;
  inputTokens: number;
  outputTokens: number;
}): void {
  const scope = storage.getStore();
  if (scope) {
    scope.providerCalls += 1;
    scope.providerMs += fields.durationMs;
    scope.inputTokens += fields.inputTokens;
    scope.outputTokens += fields.outputTokens;
  }
  emit("info", "ai.provider.call", fields);
}

/**
 * A model round-trip that failed, or a provider that could not be built.
 *
 * `message` is `ProviderRequestError`'s, which the provider layer already
 * reduces to error type and HTTP status precisely because the SDK's own
 * message echoes the request payload — and that payload carries hotel
 * data. What arrives here is safe by construction, not by trust.
 */
export function logProviderFailure(fields: {
  kind: "configuration" | "request";
  provider?: string;
  model?: string;
  round?: number;
  durationMs?: number;
  status?: number;
  message: string;
}): void {
  emit("error", "ai.provider.error", {
    ...fields,
    message: truncate(fields.message, MAX_MESSAGE),
  });
}

/**
 * One tool call, as the operator sees it: which tool, how long, whether it
 * worked. The arguments and the result are not here — they are in
 * `aiAuditLog`, redacted, behind the hotel's own access control.
 */
export function logToolCall(
  record: ToolCallRecord,
  fields: { actionType: "read" | "write" | "unknown"; proposed: boolean }
): void {
  const scope = storage.getStore();
  if (scope) scope.toolCalls += 1;

  const level =
    record.status === "ok" || record.status === "confirmation_required"
      ? "info"
      : "warn";

  emit(level, "ai.tool.call", {
    toolName: record.toolName,
    actionType: fields.actionType,
    status: record.status,
    errorKind: record.errorKind ?? null,
    durationMs: record.durationMs,
    reusedEarlierResult: record.reusedEarlierResult ?? false,
    proposed: fields.proposed,
  });
}

/**
 * A step in the confirmation flow. Kept separate from `ai.tool.call` so
 * "how many proposed changes are never confirmed?" is one query — that
 * ratio is a product question as much as an operational one.
 */
export function logConfirmation(fields: {
  phase: "proposed" | "confirmed" | "refused" | "failed";
  toolName: string | null;
  durationMs?: number;
  errorKind?: ToolFailureKind;
}): void {
  emit(fields.phase === "failed" ? "warn" : "info", "ai.confirmation", {
    ...fields,
    errorKind: fields.errorKind ?? null,
  });
}

/**
 * Something went wrong that no code path expected.
 *
 * This is the one event carrying free text: a thrown error's own message
 * and stack. An error stripped of its message is a notification that
 * something broke with no way to find out what, and the alternative — the
 * status quo before this phase — was `console.error(err)`, which logged
 * strictly more. It is capped, and it is the event to exclude first if
 * these logs are ever drained somewhere less trusted than the deployment.
 */
export function logInternalError(
  scope: ErrorScope,
  err: unknown,
  fields: Fields = {}
): void {
  const error = err instanceof Error ? err : undefined;
  emit("error", "ai.error", {
    scope,
    errorName: error?.name ?? typeof err,
    message: truncate(error?.message ?? String(err), MAX_MESSAGE),
    stack: error?.stack ? truncate(error.stack, MAX_STACK) : undefined,
    ...fields,
  });
}

/** A problem the code handled and continued through. */
export function logProblem(problem: ProblemKind, fields: Fields = {}): void {
  emit("warn", "ai.problem", { problem, ...fields });
}
