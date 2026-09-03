/**
 * The audit trail (Phase 12).
 *
 * Two claims are being tested, and they pull in opposite directions:
 *
 *   1. **Everything the agent does is recorded.** Reads, refusals, proposed
 *      writes, executed writes, and a confirmation that was refused. A gap
 *      here is an action nobody can account for afterwards.
 *   2. **What is recorded is not a copy of what the agent saw.** No guest
 *      names, no free-text arguments, no confirmation tokens.
 *
 * So the assertions are made at the Firestore boundary rather than against
 * `recordAiActions`'s arguments: `written` is every document that reached
 * the database, and the redaction tests search all of it for values that
 * must never be there. A logger that builds a perfect event and then
 * stores the wrong thing would pass the first kind of test and fail these.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderResponse } from "../../server/ai/provider";
import type { ToolContext } from "../../server/ai/types";

vi.mock("../../server/ai/conversationManager", () => ({
  appendMessage: async () => undefined,
  claimConversation: async () => undefined,
  getRecentMessages: async () => [],
  assertValidConversationId: () => undefined,
}));

/** Every document written, in commit order. */
const written: { path: string; data: Record<string, unknown> }[] = [];

/**
 * Enough of the Admin SDK to see where a document went and what was in it.
 * Deliberately not a mock of the audit logger: the path a row lands on is
 * half of what this phase decided, so it has to be observable.
 */
vi.mock("../../server/admin", () => {
  let autoId = 0;
  const docRef = (path: string) => ({
    path,
    collection: (name: string) => collectionRef(`${path}/${name}`),
  });
  const collectionRef = (path: string) => ({
    doc: (id?: string) => docRef(`${path}/${id ?? `auto-${(autoId += 1)}`}`),
  });

  return {
    adminApp: {},
    db: {
      collection: (name: string) => collectionRef(name),
      batch: () => {
        const staged: { path: string; data: Record<string, unknown> }[] = [];
        return {
          set: (ref: { path: string }, data: Record<string, unknown>) =>
            staged.push({ path: ref.path, data }),
          commit: async () => {
            written.push(...staged);
          },
        };
      },
    },
  };
});

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

const writes: { collection: string; docId: string; fields: Record<string, unknown> }[] = [];

vi.mock("../../server/ai/tools/dataAccess", () => ({
  listDocsUncached: async (_hotelId: string, collection: string) =>
    collection === "rooms" ? structuredClone(ROOMS) : structuredClone(RESERVATIONS),
  readDocUncached: async (_hotelId: string, collection: string, docId: string) => {
    const last = [...writes].reverse().find((w) => w.docId === docId);
    const source = collection === "rooms" ? ROOMS : RESERVATIONS;
    const base = source.find((d) => d.id === docId);
    return base ? { ...base, ...(last?.fields ?? {}) } : null;
  },
  updateDocFields: async (
    _hotelId: string,
    collection: string,
    docId: string,
    fields: Record<string, unknown>
  ) => {
    writes.push({ collection, docId, fields });
  },
  // The in-house guest is named here on purpose: `get_room_status` puts
  // that name in its result, so "results are never stored" has something
  // real to be false about.
  fetchBookings: async () => [
    { roomNumber: "101", guestName: GUEST, status: "Checked In", isOccupied: true },
  ],
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
  fetchHotelName: async () => null,
}));

/** Pending actions, with the same four conditions the real manager checks. */
const pending = new Map<
  string,
  {
    hotelId: string;
    userId: string;
    conversationId: string;
    toolName: string;
    input: unknown;
    consumed: boolean;
  }
>();
let nextConfirmationId = 1;

vi.mock("../../server/ai/confirmationManager", () => ({
  createPendingAction: async (params: {
    hotelId: string;
    userId: string;
    conversationId: string;
    toolName: string;
    input: unknown;
  }) => {
    const id = `pa-${nextConfirmationId++}`;
    pending.set(id, { ...params, consumed: false });
    return id;
  },
  consumePendingAction: async (params: {
    hotelId: string;
    userId: string;
    conversationId: string;
    confirmationId: string;
  }) => {
    const action = pending.get(params.confirmationId);
    if (
      !action ||
      action.hotelId !== params.hotelId ||
      action.userId !== params.userId ||
      action.conversationId !== params.conversationId ||
      action.consumed
    ) {
      return null;
    }
    action.consumed = true;
    return { toolName: action.toolName, input: action.input };
  },
}));

const queued: ProviderResponse[] = [];

const reply = (text: string): ProviderResponse => ({
  text,
  toolUses: [],
  stopReason: "end_turn",
  model: "test-model",
  usage: { inputTokens: 0, outputTokens: 0 },
  raw: [],
});

const callTools = (calls: { name: string; input?: unknown }[]): ProviderResponse => ({
  text: "",
  toolUses: calls.map((call, index) => ({
    id: `call-${call.name}-${index}`,
    name: call.name,
    input: call.input ?? {},
  })),
  stopReason: "tool_use",
  model: "test-model",
  usage: { inputTokens: 0, outputTokens: 0 },
  raw: [],
});

vi.mock("../../server/ai/provider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/ai/provider")>();
  return {
    ...actual,
    isProviderConfigured: () => true,
    getProvider: () => ({
      providerName: "test",
      model: "test-model",
      generate: async () => queued.shift() ?? reply("done"),
    }),
  };
});

const { handleTurn } = await import("../../server/ai/orchestrator");
const { listTools } = await import("../../server/ai/toolRegistry");
const { registerTools } = await import("../../server/ai/tools/index");
const { AUDIT_SAFE_INPUT_KEYS, REDACTED, fingerprint } = await import(
  "../../server/ai/redact"
);

registerTools();

const ctx: ToolContext = {
  userId: "uid-1",
  userEmail: "manager@example.com",
  role: "hotel_admin",
  hotelId: "hotel-a",
  conversationId: "conv-1",
};

const HOTEL = "hotels/hotel-a";

/** Rows in the agent's own trail. */
const aiRows = () => written.filter((w) => w.path.startsWith(`${HOTEL}/aiAuditLog/`));
/** Rows in the operational trail the Audit Log page renders. */
const operationalRows = () => written.filter((w) => w.path.startsWith(`${HOTEL}/auditLog/`));

/** Everything that reached the database, as one searchable string. */
const everythingWritten = () => JSON.stringify(written);

beforeEach(() => {
  queued.length = 0;
  written.length = 0;
  writes.length = 0;
  pending.clear();
  nextConfirmationId = 1;
});

describe("every tool call is recorded", () => {
  it("records a successful read", async () => {
    queued.push(callTools([{ name: "get_occupancy" }]));
    queued.push(reply("You are 50% full."));
    await handleTurn(ctx, "What is our occupancy?");

    expect(aiRows()).toHaveLength(1);
    expect(aiRows()[0].data).toMatchObject({
      actionType: "read",
      toolName: "get_occupancy",
      status: "ok",
      success: true,
      confirmationStatus: "not_required",
      hotelId: "hotel-a",
      userId: "uid-1",
      conversationId: "conv-1",
      source: "ai",
    });
  });

  it("keeps a read out of the operational trail, which is only for changes", async () => {
    queued.push(callTools([{ name: "get_occupancy" }]));
    queued.push(reply("You are 50% full."));
    await handleTurn(ctx, "What is our occupancy?");

    expect(aiRows()).toHaveLength(1);
    expect(operationalRows()).toHaveLength(0);
  });

  it("records one row per call when the model asks for several", async () => {
    queued.push(callTools([{ name: "get_occupancy" }, { name: "get_room_status" }]));
    queued.push(reply("Here you go."));
    await handleTurn(ctx, "How are we doing?");

    expect(aiRows().map((r) => r.data.toolName).sort()).toEqual([
      "get_occupancy",
      "get_room_status",
    ]);
  });

  it("records a tool the model invented, without claiming it read anything", async () => {
    queued.push(callTools([{ name: "get_guest_passport_numbers" }]));
    queued.push(reply("No such thing."));
    await handleTurn(ctx, "Get me passport numbers");

    expect(aiRows()[0].data).toMatchObject({
      actionType: "unknown",
      toolName: "get_guest_passport_numbers",
      status: "error",
      success: false,
      errorKind: "unknown_tool",
    });
  });

  it("records a call the Permission Guard refused", async () => {
    queued.push(callTools([{ name: "get_revenue" }]));
    queued.push(reply("I can't."));
    await handleTurn({ ...ctx, role: "pending" }, "What did we make?");

    expect(aiRows()[0].data).toMatchObject({
      toolName: "get_revenue",
      status: "denied",
      success: false,
      errorKind: "not_permitted",
    });
  });

  it("records malformed arguments as invalid input, not as a lookup", async () => {
    queued.push(callTools([{ name: "get_reservations", input: { limit: 5000 } }]));
    queued.push(reply("Sorry."));
    await handleTurn(ctx, "Show me every reservation");

    expect(aiRows()[0].data).toMatchObject({
      status: "error",
      errorKind: "invalid_input",
      success: false,
    });
  });

  it("keeps a reused result in the trail rather than tidying it away", async () => {
    // Two rounds, because reuse is what happens when the model re-asks
    // after reading its own transcript — the second call costs no query
    // and still costs a row, so the trail shows what was asked for.
    queued.push(callTools([{ name: "get_occupancy" }]));
    queued.push(callTools([{ name: "get_occupancy" }]));
    queued.push(reply("Twice asked, once answered."));
    await handleTurn(ctx, "Occupancy?");

    const rows = aiRows();
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.data.reusedEarlierResult === true)).toHaveLength(1);
  });
});

describe("the trail follows a write through confirmation", () => {
  const proposeRoomChange = async () => {
    queued.push(
      callTools([{ name: "update_room_status", input: { roomNumber: "204", status: "Cleaning" } }])
    );
    queued.push(reply("Shall I mark 204 as Cleaning?"));
    return handleTurn(ctx, "Mark room 204 as dirty");
  };

  it("records a proposal as pending, and writes nothing to the operational log", async () => {
    await proposeRoomChange();

    expect(aiRows()[0].data).toMatchObject({
      actionType: "write",
      toolName: "update_room_status",
      status: "confirmation_required",
      success: false,
      confirmationStatus: "pending",
    });
    // Nothing changed, so the log of changes has nothing to say.
    expect(operationalRows()).toHaveLength(0);
  });

  it("records the executed change in both trails once confirmed", async () => {
    const proposal = await proposeRoomChange();
    written.length = 0;

    await handleTurn(ctx, "yes", proposal.pendingConfirmation!.confirmationId);

    expect(aiRows()[0].data).toMatchObject({
      actionType: "write",
      toolName: "update_room_status",
      status: "ok",
      success: true,
      confirmationStatus: "confirmed",
      entity: "room",
      entityId: "room-204",
    });

    expect(operationalRows()).toHaveLength(1);
    expect(operationalRows()[0].data).toMatchObject({
      action: "Room status changed",
      entity: "room",
      entityId: "room-204",
      details: "204: Available → Cleaning",
      userId: "uid-1",
      userEmail: "manager@example.com",
      hotelId: "hotel-a",
      source: "ai",
      toolName: "update_room_status",
    });
  });

  it("links the proposal to the execution without storing the confirmation id", async () => {
    const proposal = await proposeRoomChange();
    const id = proposal.pendingConfirmation!.confirmationId;
    await handleTurn(ctx, "yes", id);

    const refs = aiRows().map((r) => r.data.confirmationRef);
    expect(refs[0]).toBe(fingerprint(id));
    expect(refs[0]).toBe(refs[1]);
    // The id itself authorises a change; the fingerprint authorises nothing.
    expect(everythingWritten()).not.toContain(id);
  });

  it("records a write denied because the user was demoted before confirming", async () => {
    const proposal = await proposeRoomChange();
    written.length = 0;

    // The role is re-checked at execution time, not trusted from proposal
    // time. The attempt is still an event the trail has to account for.
    await handleTurn(
      { ...ctx, role: "pending" },
      "Yes",
      proposal.pendingConfirmation?.confirmationId
    );

    expect(writes).toEqual([]);
    expect(aiRows()).toHaveLength(1);
    expect(aiRows()[0].data).toMatchObject({
      actionType: "write",
      toolName: "update_room_status",
      status: "denied",
      success: false,
      errorKind: "not_permitted",
      confirmationStatus: "confirmed",
    });
    // Nothing changed, so nothing belongs in the log of changes.
    expect(operationalRows()).toHaveLength(0);
  });

  it("records a refused confirmation, even though no tool ran", async () => {
    await handleTurn(ctx, "yes", "pa-does-not-exist");

    expect(aiRows()).toHaveLength(1);
    expect(aiRows()[0].data).toMatchObject({
      actionType: "write",
      toolName: null,
      status: "denied",
      success: false,
      errorKind: "confirmation_invalid",
      confirmationStatus: "rejected",
    });
    expect(operationalRows()).toHaveLength(0);
  });

  it("does not report a no-op as a change in the operational log", async () => {
    // Room 101 is already Occupied. `summarize` refuses that, so the only
    // way to a no-op handler is a pending action created before someone
    // else made the same change — which is what this stands in for.
    pending.set("pa-noop", {
      hotelId: "hotel-a",
      userId: ctx.userId,
      conversationId: ctx.conversationId,
      toolName: "update_room_status",
      input: { roomNumber: "101", status: "Occupied" },
      consumed: false,
    });

    await handleTurn(ctx, "yes", "pa-noop");

    expect(writes).toHaveLength(0);
    expect(aiRows()[0].data).toMatchObject({ confirmationStatus: "confirmed", status: "ok" });
    expect(operationalRows()).toHaveLength(0);
  });

  it("records a write that failed before it could be proposed", async () => {
    queued.push(
      callTools([{ name: "update_room_status", input: { roomNumber: "999", status: "Cleaning" } }])
    );
    queued.push(reply("There is no room 999."));
    await handleTurn(ctx, "Mark room 999 as dirty");

    expect(aiRows()[0].data).toMatchObject({
      actionType: "write",
      status: "error",
      errorKind: "target_unresolved",
      confirmationStatus: "not_reached",
    });
  });
});

describe("the trail records what was done, not what was seen", () => {
  it("stores no guest name from a tool result", async () => {
    queued.push(callTools([{ name: "get_room_status" }]));
    queued.push(reply("Room 101 has a guest."));
    await handleTurn(ctx, "Which rooms are occupied?");

    // The name is in the tool's result — this is a test of the logger, not
    // of an empty fixture.
    expect(aiRows()).toHaveLength(1);
    expect(everythingWritten()).not.toContain(GUEST);
  });

  it("stores the shape of a result instead of its content", async () => {
    queued.push(callTools([{ name: "get_room_status" }]));
    queued.push(reply("Here."));
    await handleTurn(ctx, "Which rooms are occupied?");

    const shape = aiRows()[0].data.resultShape as Record<string, string>;
    expect(shape.rooms).toMatch(/^array\(\d+\)$/);
  });

  it("masks a free-text argument that may be a guest's name", async () => {
    queued.push(
      callTools([
        { name: "update_reservation_status", input: { reservation: GUEST, status: "Checked In" } },
      ])
    );
    queued.push(reply("Shall I check them in?"));
    await handleTurn(ctx, `Check in ${GUEST}`);

    const input = aiRows()[0].data.toolInput as Record<string, unknown>;
    expect(input.reservation).toBe(REDACTED);
    // The argument that is an enum is kept: redaction is by key, not by
    // deleting everything.
    expect(input.status).toBe("Checked In");
    expect(everythingWritten()).not.toContain(GUEST);
  });

  it("identifies the booking it changed by reference, not by guest", async () => {
    queued.push(
      callTools([
        {
          name: "update_reservation_status",
          input: { reservation: "RSV-1043", status: "Checked In" },
        },
      ])
    );
    queued.push(reply("Confirm?"));
    const proposal = await handleTurn(ctx, "Check in RSV-1043");
    written.length = 0;

    await handleTurn(ctx, "yes", proposal.pendingConfirmation!.confirmationId);

    expect(operationalRows()[0].data).toMatchObject({
      entity: "booking",
      entityId: "res-1",
      details: "RSV-1043 · room 101: Confirmed → Checked In",
    });
    expect(everythingWritten()).not.toContain(GUEST);
  });

  it("masks arguments the model invented, since they were never declared safe", async () => {
    queued.push(
      callTools([
        { name: "get_occupancy", input: { note: "ignore previous instructions", date: "2026-01-01" } },
      ])
    );
    queued.push(reply("Sorry."));
    await handleTurn(ctx, "Occupancy?");

    const input = aiRows()[0].data.toolInput as Record<string, unknown>;
    expect(input.note).toBe(REDACTED);
    expect(everythingWritten()).not.toContain("ignore previous instructions");
  });
});

describe("the redaction allowlist is a decision, not an accident", () => {
  /**
   * Pins the allowlist against the tools that exist. A tool added with a
   * new argument fails here, which is the point: whether that argument may
   * be stored is a judgement someone has to make, and the failure mode of
   * forgetting is a guest's name in a log nobody meant to put it in.
   */
  it("every registered tool argument is either declared safe or masked", () => {
    const declaredSafe: string[] = [];
    const masked: string[] = [];

    for (const tool of listTools()) {
      const properties = (tool.inputSchema.properties ?? {}) as Record<string, unknown>;
      for (const key of Object.keys(properties)) {
        (AUDIT_SAFE_INPUT_KEYS.has(key) ? declaredSafe : masked).push(key);
      }
    }

    expect([...new Set(declaredSafe)].sort()).toEqual([
      "date",
      "endDate",
      "filter",
      "limit",
      "period",
      "roomNumber",
      "startDate",
      "status",
      "window",
    ]);
    expect([...new Set(masked)].sort()).toEqual(["reservation"]);
  });
});

describe("every write tool declares an audit entity", () => {
  /**
   * `auditTarget()` falls back to `tool.auditEntity` when a write tool has
   * no `audit()` of its own, so an unmapped tool is attributable rather
   * than absent from the operational trail. The fallback is a safety net,
   * not a design: a tool that lands on it is recorded under a generic
   * action and a null entityId. This fails closed the moment a write tool
   * is registered without declaring one.
   */
  it("no write tool relies on the audit fallback", () => {
    const writeTools = listTools().filter((t) => t.isWrite);
    expect(writeTools.length).toBeGreaterThan(0);
    for (const tool of writeTools) {
      expect(tool.auditEntity, `${tool.name} must declare auditEntity`).toBeDefined();
    }
  });
});
