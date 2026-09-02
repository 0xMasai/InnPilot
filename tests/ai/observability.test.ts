/**
 * Structured logging and failure handling (Phase 13).
 *
 * Three claims, and the third is the reason the first two are worth having:
 *
 *   1. **A request accounts for itself.** One id ties every line together
 *      and comes back to the caller; the totals line says how the turn
 *      ended, how long the model took, and how much of the latency was
 *      ours.
 *   2. **A log line is not a copy of the conversation.** The question, the
 *      tool arguments, the results, the guest names and the API key are
 *      absent from every line — logs leave the boundary Firestore stays
 *      inside.
 *   3. **Nothing is invented when something breaks.** A failed tool, a
 *      failed provider, a failed history write and an outright bug each
 *      produce an honest reply and a record of what happened, rather than
 *      an answer the data does not support or a dead conversation.
 *
 * Assertions are made on what actually reached the console, parsed back
 * from JSON — a logger that builds the right event and prints the wrong
 * thing fails here and would pass a test of its arguments.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderResponse } from "../../server/ai/provider";
import type { Role } from "../../server/ai/types";

const state = vi.hoisted(() => ({
  /** Make the conversation history write fail, as Firestore can. */
  appendFails: false,
  /** Make `get_occupancy`'s underlying read fail, as Firestore can. */
  bookingsFail: false,
  /** Who the Context Manager resolves the caller to. */
  role: "hotel_admin" as Role,
  hotelId: "hotel-a" as string | null,
  /** Make the Context Manager itself blow up — an unexpected gateway bug. */
  contextThrows: false,
}));

vi.mock("../../server/ai/conversationManager", () => ({
  appendMessage: async () => {
    if (state.appendFails) throw new Error("history write failed");
  },
  claimConversation: async () => undefined,
  getRecentMessages: async () => [],
  assertValidConversationId: () => undefined,
}));

// The audit trail is Phase 12's, exercised in its own file; here it would
// only add Firestore mocking to tests about the console.
vi.mock("../../server/ai/auditLogger", () => ({
  recordAiActions: async () => undefined,
}));

vi.mock("../../server/admin", () => ({ adminApp: {}, db: {} }));

vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({
    verifyIdToken: async (token: string) => {
      if (token !== "good-token") throw new Error("bad token");
      return { uid: "uid-1" };
    },
  }),
}));

vi.mock("../../server/ai/contextManager", () => ({
  resolveToolContext: async (uid: string, conversationId: string) => {
    if (state.contextThrows) throw new Error("users lookup exploded");
    return {
      userId: uid,
      userEmail: "manager@example.com",
      role: state.role,
      hotelId: state.hotelId,
      conversationId,
    };
  },
}));

const GUEST = "Ada Lovelace";

const ROOMS = [
  { id: "room-204", number: "204", type: "Double", status: "Available" },
  { id: "room-101", number: "101", type: "Single", status: "Occupied" },
];

const RESERVATIONS = [
  {
    id: "res-1",
    reservationId: "RSV-1043",
    guestName: GUEST,
    roomNumber: "101",
    status: "Confirmed",
  },
];

vi.mock("../../server/ai/tools/dataAccess", () => ({
  listDocsUncached: async (_hotelId: string, collection: string) =>
    collection === "rooms" ? structuredClone(ROOMS) : structuredClone(RESERVATIONS),
  readDocUncached: async (_hotelId: string, collection: string, docId: string) => {
    const source = collection === "rooms" ? ROOMS : RESERVATIONS;
    return source.find((d) => d.id === docId) ?? null;
  },
  updateDocFields: async () => undefined,
  fetchBookings: async () => {
    if (state.bookingsFail) throw new Error("Firestore: 7 PERMISSION_DENIED on accomodation");
    return [{ roomNumber: "101", guestName: GUEST, status: "Checked In", isOccupied: true }];
  },
  fetchRooms: async () => structuredClone(ROOMS),
  fetchRoomsWithIds: async () => structuredClone(ROOMS),
  fetchOrders: async () => [],
  fetchEvents: async () => [],
  fetchExpenses: async () => [],
  fetchReservations: async () => structuredClone(RESERVATIONS),
  fetchMetricsInput: async () => ({
    bookings: [],
    orders: [],
    events: [],
    expenses: [],
    rooms: [],
  }),
  fetchHotelName: async () => "Test Hotel",
}));

const pending = new Map<string, { toolName: string; input: unknown; consumed: boolean }>();
let nextConfirmationId = 1;

vi.mock("../../server/ai/confirmationManager", () => ({
  createPendingAction: async (params: { toolName: string; input: unknown }) => {
    const id = `pa-${nextConfirmationId++}`;
    pending.set(id, { toolName: params.toolName, input: params.input, consumed: false });
    return id;
  },
  consumePendingAction: async (params: { confirmationId: string }) => {
    const action = pending.get(params.confirmationId);
    if (!action || action.consumed) return null;
    action.consumed = true;
    return { toolName: action.toolName, input: action.input };
  },
}));

/** What the mocked provider does next: answer, ask for tools, or fail. */
type Step = { kind: "response"; value: ProviderResponse } | { kind: "throw"; error: Error };

const steps: Step[] = [];

const reply = (text: string): Step => ({
  kind: "response",
  value: {
    text,
    toolUses: [],
    stopReason: "end_turn",
    model: "test-model",
    usage: { inputTokens: 120, outputTokens: 45 },
    raw: [],
  },
});

const refusal = (): Step => ({
  kind: "response",
  value: {
    text: "",
    toolUses: [],
    stopReason: "refusal",
    model: "test-model",
    usage: { inputTokens: 10, outputTokens: 0 },
    raw: [],
  },
});

const callTools = (calls: { name: string; input?: unknown }[]): Step => ({
  kind: "response",
  value: {
    text: "",
    toolUses: calls.map((call, index) => ({
      id: `call-${call.name}-${index}`,
      name: call.name,
      input: call.input ?? {},
    })),
    stopReason: "tool_use",
    model: "test-model",
    usage: { inputTokens: 200, outputTokens: 30 },
    raw: [],
  },
});

vi.mock("../../server/ai/provider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/ai/provider")>();
  return {
    ...actual,
    isProviderConfigured: () => true,
    getProvider: () => ({
      providerName: "test",
      model: "test-model",
      generate: async () => {
        const step = steps.shift() ?? reply("done").value;
        if ("kind" in step && step.kind === "throw") throw step.error;
        return (step as { value: ProviderResponse }).value;
      },
    }),
  };
});

const { handleAiChat, AiChatError } = await import("../../server/ai/aiChat");
const { ProviderRequestError } = await import("../../server/ai/provider");

/** Every structured line that reached the console, parsed. */
interface LogLine {
  level: string;
  event: string;
  requestId?: string;
  [key: string]: unknown;
}

let lines: { raw: string; parsed: LogLine }[] = [];

function capture(): void {
  const record = (value: unknown) => {
    const raw = String(value);
    try {
      const parsed = JSON.parse(raw) as LogLine;
      if (parsed && typeof parsed.event === "string") lines.push({ raw, parsed });
    } catch {
      // Not one of ours; a stray console call from elsewhere.
    }
  };
  vi.spyOn(console, "log").mockImplementation(record);
  vi.spyOn(console, "warn").mockImplementation(record);
  vi.spyOn(console, "error").mockImplementation(record);
}

const events = (name: string) => lines.filter((l) => l.parsed.event === name).map((l) => l.parsed);
const only = (name: string) => {
  const found = events(name);
  expect(found).toHaveLength(1);
  return found[0];
};
/** Everything logged, as one searchable string. */
const everythingLogged = () => lines.map((l) => l.raw).join("\n");

async function ask(
  message: string,
  options: { confirmationId?: string; idToken?: string | null; body?: unknown } = {}
) {
  return handleAiChat({
    idToken: options.idToken === undefined ? "good-token" : options.idToken,
    body:
      options.body !== undefined
        ? options.body
        : {
            message,
            conversationId: "conv-1",
            ...(options.confirmationId ? { confirmationId: options.confirmationId } : {}),
          },
  });
}

beforeEach(() => {
  // Under Vitest the logger defaults to silent, so a suite that exercises
  // the orchestrator does not print a few hundred lines. These tests are
  // about the lines, so they ask for them.
  process.env.AI_LOG_LEVEL = "debug";
  process.env.AI_API_KEY = "sk-test-not-a-real-key";
  lines = [];
  steps.length = 0;
  pending.clear();
  nextConfirmationId = 1;
  state.appendFails = false;
  state.bookingsFail = false;
  state.contextThrows = false;
  state.role = "hotel_admin";
  state.hotelId = "hotel-a";
  capture();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.AI_LOG_LEVEL;
  delete process.env.AI_API_KEY;
});

describe("a request accounts for itself", () => {
  it("ties every line to one id, and returns that id to the caller", async () => {
    steps.push(callTools([{ name: "get_occupancy" }]), reply("You are 50% full."));
    const response = await ask("What is our occupancy?");

    expect(response.requestId).toMatch(/^[0-9a-f]{12}$/);
    expect(lines.length).toBeGreaterThan(3);
    for (const { parsed } of lines) {
      expect(parsed.requestId).toBe(response.requestId);
    }
  });

  it("records who asked, without recording what they asked", async () => {
    steps.push(reply("Hello."));
    await ask("How many guests does Ada Lovelace have staying?");

    expect(only("ai.request.start")).toMatchObject({
      messageLength: "How many guests does Ada Lovelace have staying?".length,
      answeringConfirmation: false,
      userId: "uid-1",
      hotelId: "hotel-a",
      role: "hotel_admin",
      conversationId: "conv-1",
    });
  });

  it("closes every request with one totals line", async () => {
    steps.push(
      callTools([{ name: "get_occupancy" }, { name: "get_room_status" }]),
      reply("Half full, two rooms free.")
    );
    await ask("How are we doing?");

    const finish = only("ai.request.finish");
    expect(finish).toMatchObject({
      outcome: "answered",
      ok: true,
      toolCalls: 2,
      providerCalls: 2,
    });
    // 200 + 120 in, 30 + 45 out, across the two model round-trips.
    expect(finish.inputTokens).toBe(320);
    expect(finish.outputTokens).toBe(75);
    expect(finish.durationMs).toBeGreaterThanOrEqual(0);
    expect(finish.overheadMs).toBeGreaterThanOrEqual(0);
    // How many distinct Firestore reads the turn issued. Zero here only
    // because `dataAccess` — the module that consults the cache — is
    // mocked out; the field is what makes read amplification visible.
    expect(finish.cachedReads).toBe(0);
  });

  it("times each model round-trip separately", async () => {
    steps.push(callTools([{ name: "get_occupancy" }]), reply("Half full."));
    await ask("Occupancy?");

    const calls = events("ai.provider.call");
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      provider: "test",
      model: "test-model",
      round: 0,
      stopReason: "tool_use",
      toolUses: 1,
    });
    expect(calls[1]).toMatchObject({ round: 1, stopReason: "end_turn", toolUses: 0 });
    expect(calls[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it("logs each tool call with its duration and outcome", async () => {
    steps.push(callTools([{ name: "get_occupancy" }]), reply("Half full."));
    await ask("Occupancy?");

    expect(only("ai.tool.call")).toMatchObject({
      level: "info",
      toolName: "get_occupancy",
      actionType: "read",
      status: "ok",
      errorKind: null,
      reusedEarlierResult: false,
      proposed: false,
    });
  });

  it("keeps a reused result in the trail rather than tidying it away", async () => {
    // Across rounds, not within one: calls in a single round run
    // concurrently, so neither can be served from the other's result.
    steps.push(
      callTools([{ name: "get_occupancy" }]),
      callTools([{ name: "get_occupancy" }]),
      reply("Half full.")
    );
    await ask("Occupancy, and again?");

    const calls = events("ai.tool.call");
    expect(calls).toHaveLength(2);
    expect(calls.map((c) => c.reusedEarlierResult)).toEqual([false, true]);
    expect(calls[1].durationMs).toBe(0);
  });

  it("raises the level of a tool call that did not work", async () => {
    steps.push(callTools([{ name: "no_such_tool" }]), reply("I could not do that."));
    await ask("Do something impossible.");

    expect(only("ai.tool.call")).toMatchObject({
      level: "warn",
      toolName: "no_such_tool",
      actionType: "unknown",
      status: "error",
      errorKind: "unknown_tool",
    });
  });
});

describe("a log line is not a copy of the conversation", () => {
  it("never logs the user's question", async () => {
    const question = "Has Ada Lovelace checked out of room 101 yet?";
    steps.push(callTools([{ name: "get_room_status" }]), reply("She has not."));
    await ask(question);

    expect(everythingLogged()).not.toContain(question);
    expect(everythingLogged()).not.toContain("Ada");
  });

  it("never logs a guest name a tool returned", async () => {
    // get_room_status puts the in-house guest's name in its own output, so
    // this is a test of the logger and not of an empty fixture.
    steps.push(callTools([{ name: "get_room_status" }]), reply("Room 101 is occupied."));
    await ask("Which rooms are occupied?");

    expect(everythingLogged()).not.toContain(GUEST);
  });

  it("never logs the arguments the model sent", async () => {
    steps.push(
      callTools([
        { name: "update_reservation_status", input: { reservation: GUEST, status: "Checked In" } },
      ]),
      reply("Shall I check that reservation in?")
    );
    await ask("Check in the reservation.");

    expect(everythingLogged()).not.toContain(GUEST);
    // The tool was still named — what happened is logged, what was said is not.
    expect(events("ai.tool.call")[0]).toMatchObject({ toolName: "update_reservation_status" });
  });

  it("never logs the provider credential", async () => {
    steps.push(reply("Hello."));
    await ask("Hello.");

    expect(everythingLogged()).not.toContain("sk-test-not-a-real-key");
  });
});

describe("nothing is invented when something breaks", () => {
  it("reports a failed tool to the operator and to the model, and answers neither way", async () => {
    state.bookingsFail = true;
    steps.push(
      callTools([{ name: "get_occupancy" }]),
      reply("I couldn't read your occupancy figures, so I can't tell you.")
    );
    const response = await ask("What is our occupancy?");

    expect(only("ai.error")).toMatchObject({
      scope: "tool_handler",
      toolName: "get_occupancy",
      errorName: "Error",
    });
    expect(only("ai.tool.call")).toMatchObject({
      status: "error",
      errorKind: "handler_failed",
    });
    // The record the UI renders says the lookup failed; no figure was
    // produced for the model to repeat.
    expect(response.toolCalls[0].status).toBe("error");
    expect(response.toolCalls[0].output).toBeUndefined();
  });

  it("logs a failed model call with its round and latency, and says it has no answer", async () => {
    steps.push({ kind: "throw", error: new ProviderRequestError("OpenAI request failed.", 503) });
    const response = await ask("What is our occupancy?");

    expect(only("ai.provider.error")).toMatchObject({
      kind: "request",
      provider: "test",
      model: "test-model",
      round: 0,
      status: 503,
    });
    expect(only("ai.request.finish")).toMatchObject({
      outcome: "provider_failed",
      ok: false,
    });
    expect(response.reply).toContain("no answer for you rather than a guessed one");
  });

  it("degrades honestly on a bug in the turn instead of losing the conversation", async () => {
    steps.push({ kind: "throw", error: new TypeError("cannot read properties of undefined") });
    const response = await ask("What is our occupancy?");

    expect(only("ai.error")).toMatchObject({ scope: "turn", errorName: "TypeError" });
    expect(only("ai.request.finish")).toMatchObject({
      outcome: "internal_error",
      ok: false,
    });
    expect(response.reply).toContain("no answer for you rather than a guessed one");
  });

  it("records a model that refused, rather than reporting an answer", async () => {
    steps.push(refusal());
    const response = await ask("Say something unacceptable.");

    expect(only("ai.request.finish")).toMatchObject({ outcome: "model_refused", ok: false });
    expect(response.reply).toContain("wasn't able to produce a response");
  });

  it("does not let a failed history write discard a finished turn", async () => {
    state.appendFails = true;
    steps.push(reply("You are 50% full."));
    const response = await ask("What is our occupancy?");

    expect(response.reply).toBe("You are 50% full.");
    expect(only("ai.request.finish")).toMatchObject({ outcome: "answered", ok: true });
    const appendErrors = events("ai.error").filter((e) => e.scope === "conversation_append");
    expect(appendErrors.length).toBeGreaterThan(0);
  });

  it("turns an unexpected gateway failure into a 500 the caller can quote", async () => {
    state.contextThrows = true;

    const failure = await ask("What is our occupancy?").catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(AiChatError);
    const chatError = failure as InstanceType<typeof AiChatError>;
    expect(chatError.status).toBe(500);
    expect(chatError.message).toBe("The assistant is unavailable right now.");
    expect(chatError.requestId).toMatch(/^[0-9a-f]{12}$/);

    expect(only("ai.error")).toMatchObject({ scope: "gateway", errorName: "Error" });
    expect(only("ai.request.rejected")).toMatchObject({ status: 500, reason: "unexpected" });
    // The message the caller is given says nothing; the log says what broke.
    expect(everythingLogged()).toContain("users lookup exploded");
  });
});

describe("refused requests", () => {
  it("distinguishes a missing token from a bad one, though the caller cannot", async () => {
    await ask("Occupancy?", { idToken: null }).catch(() => undefined);
    expect(only("ai.request.rejected")).toMatchObject({
      status: 401,
      reason: "unauthenticated",
    });

    lines = [];
    const failure = await ask("Occupancy?", { idToken: "forged" }).catch(
      (err: unknown) => err as InstanceType<typeof AiChatError>
    );
    expect(only("ai.request.rejected")).toMatchObject({ status: 401, reason: "invalid_token" });
    // Same sentence for both, on purpose.
    expect(failure.message).toBe("Sign in required.");
  });

  it("records a malformed request without echoing it", async () => {
    await ask("", { body: { message: "  ", conversationId: "../other-hotel" } }).catch(
      () => undefined
    );

    expect(only("ai.request.rejected")).toMatchObject({ status: 400, reason: "invalid_request" });
    expect(everythingLogged()).not.toContain("../other-hotel");
  });

  it("records an account with no hotel", async () => {
    state.role = "pending";
    state.hotelId = null;

    await ask("Occupancy?").catch(() => undefined);
    expect(only("ai.request.rejected")).toMatchObject({ status: 403, reason: "no_hotel" });
  });

  it("still emits a totals line for a request it refused", async () => {
    await ask("Occupancy?", { idToken: null }).catch(() => undefined);
    expect(only("ai.request.finish")).toMatchObject({ outcome: "rejected", ok: false });
  });
});

describe("the confirmation flow", () => {
  it("logs a proposed change, and the turn that is waiting on it", async () => {
    steps.push(
      callTools([{ name: "update_room_status", input: { roomNumber: "204", status: "Cleaning" } }]),
      reply("Shall I mark room 204 as cleaning?")
    );
    const response = await ask("Mark room 204 as cleaning.");

    expect(only("ai.confirmation")).toMatchObject({
      phase: "proposed",
      toolName: "update_room_status",
    });
    expect(only("ai.tool.call")).toMatchObject({
      actionType: "write",
      status: "confirmation_required",
      proposed: true,
    });
    expect(only("ai.request.finish")).toMatchObject({
      outcome: "confirmation_pending",
      ok: true,
    });
    expect(response.pendingConfirmation?.toolName).toBe("update_room_status");
  });

  it("logs the confirmed write as its own outcome", async () => {
    steps.push(
      callTools([{ name: "update_room_status", input: { roomNumber: "204", status: "Cleaning" } }]),
      reply("Shall I mark room 204 as cleaning?")
    );
    const proposal = await ask("Mark room 204 as cleaning.");
    lines = [];

    const confirmed = await ask("yes", {
      confirmationId: proposal.pendingConfirmation?.confirmationId,
    });

    expect(only("ai.confirmation")).toMatchObject({
      phase: "confirmed",
      toolName: "update_room_status",
    });
    expect(only("ai.request.finish")).toMatchObject({ outcome: "confirmed_write", ok: true });
    expect(confirmed.reply).toContain("Done");
    // No model round-trip on the confirming half — the reply is built from
    // the tool's own result.
    expect(events("ai.provider.call")).toHaveLength(0);
  });

  it("records a confirmation it refused", async () => {
    const response = await ask("yes", { confirmationId: "pa-does-not-exist" });

    expect(only("ai.confirmation")).toMatchObject({
      phase: "refused",
      toolName: null,
      errorKind: "confirmation_invalid",
    });
    expect(only("ai.request.finish")).toMatchObject({
      outcome: "confirmation_rejected",
      ok: false,
    });
    expect(response.reply).toContain("no longer valid");
  });

  it("does not report a completed write as a failure when history cannot be saved", async () => {
    steps.push(
      callTools([{ name: "update_room_status", input: { roomNumber: "204", status: "Cleaning" } }]),
      reply("Shall I mark room 204 as cleaning?")
    );
    const proposal = await ask("Mark room 204 as cleaning.");
    state.appendFails = true;

    const confirmed = await ask("yes", {
      confirmationId: proposal.pendingConfirmation?.confirmationId,
    });
    expect(confirmed.reply).toContain("Done");
  });
});

describe("log level", () => {
  it("drops routine lines at error level but keeps failures", async () => {
    process.env.AI_LOG_LEVEL = "error";
    state.bookingsFail = true;
    steps.push(callTools([{ name: "get_occupancy" }]), reply("I couldn't check."));
    await ask("Occupancy?");

    expect(events("ai.request.start")).toHaveLength(0);
    expect(events("ai.provider.call")).toHaveLength(0);
    expect(events("ai.request.finish")).toHaveLength(0);
    expect(events("ai.error")).toHaveLength(1);
  });

  it("says nothing at all when silenced", async () => {
    process.env.AI_LOG_LEVEL = "silent";
    steps.push(reply("Hello."));
    await ask("Hello.");

    expect(lines).toHaveLength(0);
  });

  it("is silent by default under a test run, so suites are not buried", async () => {
    delete process.env.AI_LOG_LEVEL;
    steps.push(reply("Hello."));
    await ask("Hello.");

    expect(lines).toHaveLength(0);
  });
});
