/**
 * Write tools and the confirmation boundary (Phase 10).
 *
 * The brief's rule is that a write must never happen on the model's say-so,
 * and that the system must never rely on the model to determine that
 * confirmation occurred. That is a claim about who holds the capability,
 * so these tests are written against the thing that would betray it: what
 * reaches the data layer, and when.
 *
 * The single assertion behind most of them is `writes` — every call to
 * `updateDocFields`. A write tool that ran when it should not have shows up
 * there, whatever the reply said.
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

vi.mock("../../server/admin", () => ({ adminApp: {}, db: {} }));

/** Every write that reached the data layer, in order. */
const writes: { collection: string; docId: string; fields: Record<string, unknown> }[] = [];

const ROOMS = [
  { id: "room-204", number: "204", type: "Double", status: "Available" },
  { id: "room-101", number: "101", type: "Single", status: "Cleaning" },
];

const RESERVATIONS = [
  { id: "res-1", reservationId: "R-1", guestName: "Ada Lovelace", status: "Confirmed" },
  { id: "res-2", reservationId: "R-2", guestName: "Grace Hopper", status: "Confirmed" },
  { id: "res-3", reservationId: "R-3", guestName: "Ada Byron", status: "Confirmed" },
];

vi.mock("../../server/ai/tools/dataAccess", () => ({
  listDocsUncached: async (_hotelId: string, collection: string) =>
    collection === "rooms" ? structuredClone(ROOMS) : structuredClone(RESERVATIONS),
  readDocUncached: async (_hotelId: string, collection: string, docId: string) => {
    // Reflects whatever the last write set, so `confirmedByReadBack` is
    // meaningful rather than a constant.
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
  fetchBookings: async () => [],
  fetchRooms: async () => [],
  fetchOrders: async () => [],
  fetchEvents: async () => [],
  fetchExpenses: async () => [],
  fetchReservations: async () => [],
  fetchRoomsWithIds: async () => [],
  fetchMetricsInput: async () => ({
    bookings: [],
    orders: [],
    events: [],
    expenses: [],
    rooms: [],
  }),
  fetchHotelName: async () => null,
}));

/** Pending actions the Confirmation Manager has issued, by id. */
const pending = new Map<
  string,
  {
    hotelId: string;
    userId: string;
    conversationId: string;
    toolName: string;
    input: unknown;
    consumed: boolean;
    expired: boolean;
  }
>();
let nextConfirmationId = 1;

// A faithful stand-in for the real manager: it enforces the same four
// conditions (same user, same conversation, unconsumed, unexpired) so the
// orchestrator's handling of a refusal is exercised, not stubbed away.
vi.mock("../../server/ai/confirmationManager", () => ({
  createPendingAction: async (params: {
    hotelId: string;
    userId: string;
    conversationId: string;
    toolName: string;
    input: unknown;
  }) => {
    const id = `pa-${nextConfirmationId++}`;
    pending.set(id, { ...params, consumed: false, expired: false });
    return id;
  },
  consumePendingAction: async (params: {
    hotelId: string;
    userId: string;
    conversationId: string;
    confirmationId: string;
  }) => {
    const action = pending.get(params.confirmationId);
    if (!action) return null;
    if (
      action.hotelId !== params.hotelId ||
      action.userId !== params.userId ||
      action.conversationId !== params.conversationId ||
      action.consumed ||
      action.expired
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

registerTools();

const ctx: ToolContext = {
  userId: "uid-1",
  userEmail: "manager@example.com",
  role: "hotel_admin",
  hotelId: "hotel-a",
  conversationId: "conv-1",
};

/** The model proposes a room change and then asks the user to confirm. */
function queueProposal(input: unknown = { roomNumber: "204", status: "Cleaning" }) {
  queued.push(callTools([{ name: "update_room_status", input }]));
  queued.push(reply("Shall I mark room 204 as Cleaning?"));
}

beforeEach(() => {
  queued.length = 0;
  writes.length = 0;
  pending.clear();
  nextConfirmationId = 1;
});

describe("a write tool is proposed, never executed on the model's word", () => {
  it("writes nothing when the model calls a write tool", async () => {
    queueProposal();
    const response = await handleTurn(ctx, "Mark room 204 as dirty");

    expect(writes).toEqual([]);
    expect(response.pendingConfirmation).toBeDefined();
    expect(response.pendingConfirmation?.toolName).toBe("update_room_status");
  });

  it("summarises the change from stored data, including the current value", async () => {
    queueProposal();
    const response = await handleTurn(ctx, "Mark room 204 as dirty");

    // 'Available' is the room's real status in the fixture — the summary is
    // read, not taken from the model's account of what it intends.
    expect(response.pendingConfirmation?.summary).toContain("204");
    expect(response.pendingConfirmation?.summary).toContain("Available");
    expect(response.pendingConfirmation?.summary).toContain("Cleaning");
  });

  it("tells the model the change has not happened", async () => {
    queued.push(callTools([{ name: "update_room_status", input: { roomNumber: "204", status: "Cleaning" } }]));
    queued.push(reply("Shall I?"));
    const response = await handleTurn(ctx, "Mark room 204 as dirty");

    const record = response.toolCalls.find((c) => c.toolName === "update_room_status");
    expect(record?.status).toBe("confirmation_required");
  });

  it("does not put the confirmation id in the model's transcript", async () => {
    queueProposal();
    const response = await handleTurn(ctx, "Mark room 204 as dirty");
    const id = response.pendingConfirmation!.confirmationId;

    // The id reaches the user's client, never the model — a value in the
    // transcript is one the model could later echo back as its own.
    expect(JSON.stringify(response.toolCalls)).not.toContain(id);
  });

  it("stores the validated input, so the write is not re-derived later", async () => {
    queueProposal();
    const response = await handleTurn(ctx, "Mark room 204 as dirty");
    const action = pending.get(response.pendingConfirmation!.confirmationId);

    expect(action?.input).toEqual({ roomNumber: "204", status: "Cleaning" });
    expect(action?.userId).toBe(ctx.userId);
    expect(action?.conversationId).toBe(ctx.conversationId);
  });
});

describe("confirming performs exactly the stored action", () => {
  async function propose(): Promise<string> {
    queueProposal();
    const response = await handleTurn(ctx, "Mark room 204 as dirty");
    return response.pendingConfirmation!.confirmationId;
  }

  it("writes once, to the resolved document", async () => {
    const confirmationId = await propose();
    const response = await handleTurn(ctx, "Yes", confirmationId);

    expect(writes).toEqual([
      { collection: "rooms", docId: "room-204", fields: { status: "Cleaning" } },
    ]);
    expect(response.reply).toContain("204");
    expect(response.toolCalls[0]?.status).toBe("ok");
  });

  it("consults no provider — the reply comes from the tool's own result", async () => {
    const confirmationId = await propose();
    // Anything the provider would say is queued here. If the confirm path
    // called it, this text would surface in the reply.
    queued.push(reply("I have deleted everything."));

    const response = await handleTurn(ctx, "Yes", confirmationId);

    expect(response.reply).not.toContain("deleted everything");
    expect(response.reply).toContain("Done");
  });

  it("refuses a second use of the same id, and writes nothing", async () => {
    const confirmationId = await propose();
    await handleTurn(ctx, "Yes", confirmationId);
    writes.length = 0;

    const replay = await handleTurn(ctx, "Yes", confirmationId);

    expect(writes).toEqual([]);
    expect(replay.reply).toContain("no longer valid");
  });

  it("refuses an id invented by the caller", async () => {
    const response = await handleTurn(ctx, "Yes", "pa-does-not-exist");

    expect(writes).toEqual([]);
    expect(response.reply).toContain("no longer valid");
  });

  it("refuses an id issued to a different user", async () => {
    const confirmationId = await propose();
    const other: ToolContext = { ...ctx, userId: "uid-2" };

    const response = await handleTurn(other, "Yes", confirmationId);

    expect(writes).toEqual([]);
    expect(response.reply).toContain("no longer valid");
  });

  it("refuses an id issued in a different conversation", async () => {
    const confirmationId = await propose();
    const elsewhere: ToolContext = { ...ctx, conversationId: "conv-2" };

    const response = await handleTurn(elsewhere, "Yes", confirmationId);

    expect(writes).toEqual([]);
    expect(response.reply).toContain("no longer valid");
  });

  it("refuses an expired id", async () => {
    const confirmationId = await propose();
    pending.get(confirmationId)!.expired = true;

    const response = await handleTurn(ctx, "Yes", confirmationId);

    expect(writes).toEqual([]);
    expect(response.reply).toContain("no longer valid");
  });

  it("re-checks the role at confirmation time, not at proposal time", async () => {
    const confirmationId = await propose();
    // Demoted in the interval. The earlier check must not carry over.
    const demoted: ToolContext = { ...ctx, role: "pending" };

    const response = await handleTurn(demoted, "Yes", confirmationId);

    expect(writes).toEqual([]);
    expect(response.toolCalls[0]?.status).toBe("denied");
    expect(response.reply).toContain("Nothing was changed");
  });
});

describe("a write the tool cannot resolve is refused before anything is pending", () => {
  it("refuses an unknown room and issues no confirmation", async () => {
    queued.push(
      callTools([{ name: "update_room_status", input: { roomNumber: "999", status: "Cleaning" } }])
    );
    queued.push(reply("There is no room 999."));

    const response = await handleTurn(ctx, "Mark room 999 as dirty");

    expect(response.pendingConfirmation).toBeUndefined();
    expect(pending.size).toBe(0);
    expect(response.toolCalls[0]?.status).toBe("error");
    expect(response.toolCalls[0]?.errorMessage).toContain("999");
  });

  it("refuses an ambiguous guest name rather than picking one", async () => {
    queued.push(
      callTools([
        { name: "update_reservation_status", input: { reservation: "Ada", status: "Checked In" } },
      ])
    );
    queued.push(reply("Which Ada?"));

    const response = await handleTurn(ctx, "Check in Ada");

    expect(response.pendingConfirmation).toBeUndefined();
    expect(writes).toEqual([]);
    expect(response.toolCalls[0]?.errorMessage).toContain("2 reservations");
  });

  it("refuses a no-op rather than asking the user to approve nothing", async () => {
    queued.push(
      callTools([{ name: "update_room_status", input: { roomNumber: "101", status: "Cleaning" } }])
    );
    queued.push(reply("It already is."));

    const response = await handleTurn(ctx, "Mark room 101 as dirty");

    expect(response.pendingConfirmation).toBeUndefined();
    expect(response.toolCalls[0]?.errorMessage).toContain("already");
  });
});

describe("only one change may await confirmation at a time", () => {
  it("proposes the first write and refuses the second in the same turn", async () => {
    queued.push(
      callTools([
        { name: "update_room_status", input: { roomNumber: "204", status: "Cleaning" } },
        { name: "update_room_status", input: { roomNumber: "101", status: "Available" } },
      ])
    );
    queued.push(reply("Shall I mark 204 as Cleaning?"));

    const response = await handleTurn(ctx, "Mark 204 dirty and 101 ready");

    expect(pending.size).toBe(1);
    expect(writes).toEqual([]);
    const statuses = response.toolCalls.map((c) => c.status);
    expect(statuses).toContain("confirmation_required");
    expect(statuses).toContain("error");
    expect(response.pendingConfirmation?.summary).toContain("204");
  });
});

describe("write tools are declared in a way the rest of the system can rely on", () => {
  const writeTools = listTools().filter((tool) => tool.isWrite);

  it("registers the write tools", () => {
    expect(writeTools.map((tool) => tool.name).sort()).toEqual([
      "update_reservation_status",
      "update_room_status",
    ]);
  });

  it("every write tool can describe what it would do", () => {
    for (const tool of writeTools) expect(tool.summarize).toBeTypeOf("function");
  });

  it("no registered tool deletes anything (Phase 11)", () => {
    for (const tool of listTools()) {
      expect(tool.name).not.toMatch(/delete|remove|destroy|purge/i);
    }
  });

  it("write tools are restricted to the roles that may write in the UI", () => {
    for (const tool of writeTools) {
      expect([...tool.allowedRoles].sort()).toEqual(["hotel_admin", "staff"]);
    }
  });
});
