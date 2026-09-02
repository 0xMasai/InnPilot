/**
 * Ask InnPilot — the agent's surface inside the existing dashboard.
 *
 * Deliberately thin. It renders a turn, the tool activity behind that turn,
 * and the states a turn can end in; it decides nothing. No prompt text, no
 * tool knowledge, and no interpretation of a reply lives here — all of that
 * is server-side in `server/ai/`, and a UI holding its own opinion of an
 * answer is exactly the drift Phase 7 centralised the prompt to prevent.
 *
 * Tool activity is shown rather than hidden because the agent's claim to be
 * trusted rests on it: a manager can see that a figure came from
 * `get_revenue` in 214ms, and not from the model's imagination.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Loader2,
  RotateCcw,
  Send,
  ShieldAlert,
  Sparkles,
  User as UserIcon,
  Wrench,
} from "lucide-react";
import {
  AiClientError,
  askInnPilot,
  newConversationId,
  type AgentResponse,
  type ToolCallRecord,
} from "../../lib/aiClient";
import { useAuth } from "../../auth/AuthProvider";

/**
 * One entry in the transcript.
 *
 * A failed turn becomes an `error` entry rather than a toast that vanishes:
 * the question stays on screen above it, so it is obvious what failed, and
 * the entry carries the text needed to retry without retyping.
 */
type Entry =
  | { kind: "user"; id: string; text: string }
  | {
      kind: "assistant";
      id: string;
      text: string;
      toolCalls: ToolCallRecord[];
      pendingConfirmation?: AgentResponse["pendingConfirmation"];
    }
  | { kind: "error"; id: string; message: string; retry: string };

/** Questions from the brief's definition of done — a usable starting point. */
const SUGGESTIONS = [
  "What's our occupancy today?",
  "How much did we make yesterday?",
  "How is the hotel doing today?",
  "Generate today's report.",
];

const STATUS_BADGE: Record<ToolCallRecord["status"], { className: string; label: string }> = {
  ok: { className: "badge badge-success", label: "ok" },
  error: { className: "badge badge-danger", label: "failed" },
  denied: { className: "badge badge-danger", label: "denied" },
  confirmation_required: { className: "badge badge-warning", label: "needs confirmation" },
};

function entryId(): string {
  return `e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * One tool call, collapsed to a single line until asked to expand.
 *
 * The arguments shown are the validated ones the server actually ran with,
 * not whatever the model first proposed, so this is what touched the data.
 */
function ToolCall({ call }: { call: ToolCallRecord }) {
  const badge = STATUS_BADGE[call.status];
  const hasDetail = call.output !== undefined || call.errorMessage !== undefined;

  return (
    <details className="group rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <summary className="flex cursor-pointer list-none items-center gap-2 p-2.5 text-xs">
        <Wrench size={14} className="flex-none text-[var(--text-muted)]" />
        <code className="font-mono font-semibold text-[var(--text)]">{call.toolName}</code>
        <span className={badge.className}>{badge.label}</span>
        {call.reusedEarlierResult && (
          <span
            className="badge badge-neutral badge-plain"
            title="Served from an earlier identical call in this turn"
          >
            reused
          </span>
        )}
        <span className="ml-auto flex items-center gap-1.5 text-[var(--text-muted)]">
          {call.durationMs}ms
          {hasDetail && (
            <ChevronDown size={13} className="transition-transform group-open:rotate-180" />
          )}
        </span>
      </summary>
      <div className="space-y-2 border-t border-[var(--border)] p-2.5 text-xs">
        <div>
          <p className="eyebrow mb-1">Arguments</p>
          <pre className="overflow-x-auto rounded-md bg-[var(--surface-muted)] p-2 font-mono text-[11px] text-[var(--text-secondary)]">
            {JSON.stringify(call.input ?? {}, null, 2)}
          </pre>
        </div>
        {call.errorMessage && (
          <div>
            <p className="eyebrow mb-1">Error</p>
            <p className="text-[var(--danger-text)]">{call.errorMessage}</p>
          </div>
        )}
        {call.output !== undefined && (
          <div>
            <p className="eyebrow mb-1">Result</p>
            <pre className="max-h-64 overflow-auto rounded-md bg-[var(--surface-muted)] p-2 font-mono text-[11px] text-[var(--text-secondary)]">
              {JSON.stringify(call.output, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </details>
  );
}

/**
 * A write the agent wants to make.
 *
 * Rendered from the gateway's own `pendingConfirmation`, never inferred
 * from the reply text — the model cannot talk its way into a confirmation
 * panel. No registered tool can produce one yet, since every Phase 4 tool
 * is read-only, so this states plainly that confirming is unavailable
 * rather than offering a button that would do nothing. Phase 10 adds the
 * write tools and the confirm route it needs.
 */
function PendingConfirmation({
  confirmation,
}: {
  confirmation: NonNullable<AgentResponse["pendingConfirmation"]>;
}) {
  return (
    <div className="mt-3 rounded-xl border border-[var(--warning-border)] bg-[var(--warning-soft)] p-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-[var(--warning-text)]">
        <ShieldAlert size={16} /> Confirmation required
      </div>
      <p className="mt-1.5 text-sm text-[var(--text-secondary)]">{confirmation.summary}</p>
      <p className="mt-1 text-xs text-[var(--text-muted)]">
        Tool: <code className="font-mono">{confirmation.toolName}</code>
      </p>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-sm btn-primary" disabled>
          Confirm
        </button>
        <span className="text-xs text-[var(--text-muted)]">
          Write actions are not enabled in this build.
        </span>
      </div>
    </div>
  );
}

export default function AskInnPilot() {
  const { hotelId, role } = useAuth();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [conversationId, setConversationId] = useState(newConversationId);

  const transcriptEnd = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  // One in-flight turn at a time, aborted on unmount so a reply never lands
  // on a component that is gone.
  const inFlight = useRef<AbortController | null>(null);

  useEffect(() => () => inFlight.current?.abort(), []);

  useEffect(() => {
    transcriptEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [entries, sending]);

  const send = useCallback(
    async (question: string) => {
      const text = question.trim();
      if (!text || sending) return;

      setEntries((prev) => [...prev, { kind: "user", id: entryId(), text }]);
      setInput("");
      setSending(true);

      const controller = new AbortController();
      inFlight.current = controller;

      try {
        const response = await askInnPilot({
          message: text,
          conversationId,
          signal: controller.signal,
        });
        // The gateway owns the conversation id; adopt what it returns rather
        // than assuming the one we sent survived.
        setConversationId(response.conversationId);
        setEntries((prev) => [
          ...prev,
          {
            kind: "assistant",
            id: entryId(),
            text: response.reply,
            toolCalls: response.toolCalls,
            pendingConfirmation: response.pendingConfirmation,
          },
        ]);
      } catch (err) {
        // A turn we cancelled ourselves is not a failure to report.
        if (err instanceof DOMException && err.name === "AbortError") return;
        const message =
          err instanceof AiClientError
            ? err.message
            : "Something went wrong talking to the assistant.";
        setEntries((prev) => [...prev, { kind: "error", id: entryId(), message, retry: text }]);
      } finally {
        if (inFlight.current === controller) inFlight.current = null;
        setSending(false);
      }
    },
    [conversationId, sending]
  );

  function startNewConversation() {
    inFlight.current?.abort();
    inFlight.current = null;
    setSending(false);
    setEntries([]);
    setConversationId(newConversationId());
    composer.current?.focus();
  }

  // The gateway refuses an account with no hotel (403). Saying so once here
  // is kinder than letting every question fail identically.
  if (role !== "super_admin" && !hotelId) {
    return (
      <section className="space-y-6">
        <header>
          <h1 className="page-title">Ask InnPilot</h1>
          <p className="page-subtitle">Your hotel's operations, in plain language.</p>
        </header>
        <div className="card card-pad flex items-center gap-3 text-sm text-[var(--text-secondary)]">
          <AlertCircle size={18} className="flex-none text-[var(--warning)]" />
          Your account is not linked to a hotel yet, so there is no data to ask about.
        </div>
      </section>
    );
  }

  return (
    <section className="flex h-[calc(100vh-9rem)] flex-col gap-4">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="page-title">Ask InnPilot</h1>
          <p className="page-subtitle">
            Answers come from this hotel's live records — every figure below was fetched, not
            guessed.
          </p>
        </div>
        {entries.length > 0 && (
          <button type="button" className="btn btn-sm btn-secondary" onClick={startNewConversation}>
            <RotateCcw size={14} /> New conversation
          </button>
        )}
      </header>

      <div className="card flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {entries.length === 0 && !sending && (
            <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
              <span className="stat-icon">
                <Sparkles size={19} />
              </span>
              <div>
                <p className="font-semibold text-[var(--text)]">Ask about your hotel</p>
                <p className="mt-1 max-w-md text-sm text-[var(--text-secondary)]">
                  Occupancy, revenue, arrivals, expenses and reports — drawn from the same records
                  the dashboards use.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    className="btn btn-sm btn-secondary"
                    onClick={() => void send(suggestion)}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}

          {entries.map((entry) => {
            if (entry.kind === "user") {
              return (
                <div key={entry.id} className="flex justify-end gap-2.5">
                  <div className="max-w-[80%] rounded-2xl rounded-br-md bg-[var(--primary)] px-3.5 py-2.5 text-sm text-white">
                    {entry.text}
                  </div>
                  <span className="mt-0.5 flex size-7 flex-none items-center justify-center rounded-full bg-[var(--surface-muted)] text-[var(--text-secondary)]">
                    <UserIcon size={15} />
                  </span>
                </div>
              );
            }

            if (entry.kind === "error") {
              return (
                <div key={entry.id} className="flex gap-2.5">
                  <span className="mt-0.5 flex size-7 flex-none items-center justify-center rounded-full bg-[var(--danger-soft)] text-[var(--danger)]">
                    <AlertCircle size={15} />
                  </span>
                  <div className="max-w-[80%] rounded-2xl rounded-bl-md border border-[var(--danger-border)] bg-[var(--danger-soft)] px-3.5 py-2.5">
                    <p className="text-sm text-[var(--danger-text)]">{entry.message}</p>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost mt-1.5 px-0"
                      onClick={() => void send(entry.retry)}
                      disabled={sending}
                    >
                      <RotateCcw size={13} /> Try again
                    </button>
                  </div>
                </div>
              );
            }

            return (
              <div key={entry.id} className="flex gap-2.5">
                <span className="stat-icon mt-0.5 size-7 flex-none">
                  <Sparkles size={15} />
                </span>
                <div className="min-w-0 max-w-[80%]">
                  <div className="rounded-2xl rounded-bl-md border border-[var(--border)] bg-[var(--surface-muted)] px-3.5 py-2.5">
                    <p className="whitespace-pre-wrap text-sm text-[var(--text)]">{entry.text}</p>
                  </div>
                  {entry.toolCalls.length > 0 && (
                    <div className="mt-2 space-y-1.5">
                      <p className="eyebrow flex items-center gap-1.5">
                        <CheckCircle2 size={12} className="text-[var(--success)]" />
                        {entry.toolCalls.length} tool{entry.toolCalls.length === 1 ? "" : "s"} used
                      </p>
                      {entry.toolCalls.map((call, index) => (
                        <ToolCall key={`${entry.id}-${call.toolName}-${index}`} call={call} />
                      ))}
                    </div>
                  )}
                  {entry.pendingConfirmation && (
                    <PendingConfirmation confirmation={entry.pendingConfirmation} />
                  )}
                </div>
              </div>
            );
          })}

          {sending && (
            <div className="flex gap-2.5">
              <span className="stat-icon mt-0.5 size-7 flex-none">
                <Sparkles size={15} />
              </span>
              <div className="flex items-center gap-2 rounded-2xl rounded-bl-md border border-[var(--border)] bg-[var(--surface-muted)] px-3.5 py-2.5 text-sm text-[var(--text-secondary)]">
                <Loader2 size={14} className="animate-spin" />
                Checking the records…
              </div>
            </div>
          )}

          <div ref={transcriptEnd} />
        </div>

        <form
          className="flex items-end gap-2 border-t border-[var(--border)] p-3"
          onSubmit={(event) => {
            event.preventDefault();
            void send(input);
          }}
        >
          <textarea
            ref={composer}
            className="textarea min-h-0 flex-1 resize-none"
            rows={1}
            value={input}
            placeholder="Ask about occupancy, revenue, arrivals…"
            disabled={sending}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              // Enter sends, Shift+Enter is a newline — the convention for a
              // composer people type one question into.
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send(input);
              }
            }}
          />
          <button type="submit" className="btn btn-primary" disabled={sending || !input.trim()}>
            {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            Ask
          </button>
        </form>
      </div>
    </section>
  );
}
