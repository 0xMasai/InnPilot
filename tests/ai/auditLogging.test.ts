/**
 * AI audit logging (Phase 15).
 *
 * Phase 12's contract is that every AI-initiated mutation is attributable on
 * the same append-only audit trail the admin UI reads. The server gateway
 * regressed to writing no audit row for a confirmed write while the client
 * WebMCP path still did — so these tests assert the boundary that betrays
 * that: whether `logAiAction` is called, and with what, when a write is
 * actually executed.
 *
 * The single load-bearing assertion is `logAiAction.mock.calls`. A confirmed
 * write that leaves no row, a read that fabricates one, or a row that
 * misattributes the actor all show up here regardless of what the reply said.
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

// The spy under test. `vi.hoisted` so the mock factory (hoisted above the
// imports) can close over the same function these tests inspect.
const { logAiAction } = vi.hoisted(() => ({
  logAiAction: vi.fn(async () => undefined),
}));
vi.mock("../../server/ai/auditLogger", () => ({ logAiAction }));

/** Every write that reached the data layer, in order. */
const writes: { collection: string; docId: string; fields: Record<string, unknown> }[] = [];

const ROOMS = [
  { id: "room-204", number: "204", type: "Double", status: "Available" },
  { id: "room-101", number: "101", type: "Single", status: "Cleaning" },
];

const RESERVATIONS = [
  { id: "res-1", reservationId: "R-1", guestName: "Ada Lovelace", status: "Confirmed" },
];

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

/** A faithful stand-in for the Confirmation Manager (same four conditions). */
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
    if (!action) return null;
    if (
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
const { registerTools } = await import("../../server/ai/tools/index");
const { listTools } = await import("../../server/ai/toolRegistry");

registerTools();

const ctx: ToolContext = {
  userId: "uid-1",
  userEmail: "manager@example.com",
  role: "hotel_admin",
  hotelId: "hotel-a",
  conversationId: "conv-1",
};

async function proposeRoomChange(): Promise<string> {
  queued.push(callTools([{ name: "update_room_status", input: { roomNumber: "204", status: "Cleaning" } }]));
  queued.push(reply("Shall I mark room 204 as Cleaning?"));
  const response = await handleTurn(ctx, "Mark room 204 as dirty");
  return response.pendingConfirmation!.confirmationId;
}

beforeEach(() => {
  queued.length = 0;
  writes.length = 0;
  pending.clear();
  nextConfirmationId = 1;
  logAiAction.mockClear();
});

describe("a confirmed write is recorded on the audit trail", () => {
  it("logs exactly one row for a successful room-status change", async () => {
    const confirmationId = await proposeRoomChange();
    // Proposing must not audit — nothing has changed yet.
    expect(logAiAction).not.toHaveBeenCalled();

    await handleTurn(ctx, "Yes", confirmationId);

    expect(logAiAction).toHaveBeenCalledTimes(1);
    const entry = logAiAction.mock.calls[0][0];
    expect(entry).toMatchObject({
      hotelId: "hotel-a",
      userId: "uid-1",
      userEmail: "manager@example.com",
      toolName: "update_room_status",
      entity: "room",
      entityId: "room-204",
      confirmationStatus: "confirmed",
      success: true,
    });
  });

  it("attributes a reservation change to the booking entity", async () => {
    queued.push(
      callTools([{ name: "update_reservation_status", input: { reservation: "R-1", status: "Checked In" } }])
    );
    queued.push(reply("Shall I check Ada in?"));
    const response = await handleTurn(ctx, "Check in R-1");
    const confirmationId = response.pendingConfirmation!.confirmationId;

    await handleTurn(ctx, "Yes", confirmationId);

    expect(logAiAction).toHaveBeenCalledTimes(1);
    expect(logAiAction.mock.calls[0][0]).toMatchObject({
      toolName: "update_reservation_status",
      entity: "booking",
      entityId: "res-1",
      success: true,
    });
  });

  it("records a denied write (user demoted before confirming) as unsuccessful, and writes nothing", async () => {
    const confirmationId = await proposeRoomChange();
    const demoted: ToolContext = { ...ctx, role: "pending" };

    await handleTurn(demoted, "Yes", confirmationId);

    expect(writes).toEqual([]);
    expect(logAiAction).toHaveBeenCalledTimes(1);
    expect(logAiAction.mock.calls[0][0]).toMatchObject({
      toolName: "update_room_status",
      confirmationStatus: "confirmed",
      success: false,
    });
  });
});

describe("reads are never audited", () => {
  it("does not log an audit row for a read-only tool call", async () => {
    queued.push(callTools([{ name: "get_occupancy", input: {} }]));
    queued.push(reply("Occupancy is 0%."));

    await handleTurn(ctx, "What's our occupancy?");

    expect(logAiAction).not.toHaveBeenCalled();
  });

  it("does not log when a proposed write is never confirmed", async () => {
    await proposeRoomChange();
    expect(logAiAction).not.toHaveBeenCalled();
  });
});

describe("an invalid confirmation id changes nothing and logs nothing", () => {
  it("does not audit an id the caller invented", async () => {
    await handleTurn(ctx, "Yes", "pa-does-not-exist");

    expect(writes).toEqual([]);
    expect(logAiAction).not.toHaveBeenCalled();
  });
});

describe("every write tool declares an audit entity", () => {
  // A write tool without one is logged under a generic fallback rather than
  // its real entity, so its rows are misattributed. This fails closed the
  // moment a new write tool is registered without declaring `auditEntity`.
  it("no write tool relies on the audit fallback", () => {
    for (const tool of listTools().filter((t) => t.isWrite)) {
      expect(tool.auditEntity, `${tool.name} must declare auditEntity`).toBeDefined();
    }
  });
});
