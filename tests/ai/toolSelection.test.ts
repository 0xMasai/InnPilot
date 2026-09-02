/**
 * Orchestration economy: the minimum work per request.
 *
 * "Select only the relevant tools" is partly a model behaviour, which no
 * offline test can assert. What *is* testable is everything the system
 * does around that choice, and that is what these cover: repeated calls
 * served from the earlier result, a hard ceiling on calls per turn, one
 * Firestore read shared by every tool in a turn that needs it, and tool
 * descriptions that actually tell the model which of two overlapping tools
 * to pick.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderRequest, ProviderResponse } from "../../server/ai/provider";
import type { ToolContext } from "../../server/ai/types";

vi.mock("../../server/ai/conversationManager", () => ({
  appendMessage: async () => undefined,
  claimConversation: async () => undefined,
  getRecentMessages: async () => [],
  assertValidConversationId: () => undefined,
}));

/** Counts real Firestore round-trips, which the request cache should collapse. */
const reads = { bookings: 0, rooms: 0, metrics: 0 };

vi.mock("../../server/admin", () => ({ adminApp: {}, db: {} }));

vi.mock("../../server/ai/tools/dataAccess", async () => {
  const { cachedRead } = await import("../../server/ai/requestCache");
  return {
    fetchBookings: (hotelId: string) =>
      cachedRead(`${hotelId}/bookings`, async () => {
        reads.bookings += 1;
        return [];
      }),
    fetchRoomsWithIds: (hotelId: string) =>
      cachedRead(`${hotelId}/rooms#withIds`, async () => {
        reads.rooms += 1;
        return [{ number: "101", type: "Double", status: "Available" }];
      }),
    fetchMetricsInput: (hotelId: string) =>
      cachedRead(`${hotelId}/metrics`, async () => {
        reads.metrics += 1;
        return { bookings: [], orders: [], events: [], expenses: [], rooms: [] };
      }),
    fetchRooms: async () => [],
    fetchOrders: async () => [],
    fetchEvents: async () => [],
    fetchExpenses: async () => [],
    fetchReservations: async () => [],
    fetchHotelName: async () => null,
  };
});

const queued: ProviderResponse[] = [];
const seenRequests: ProviderRequest[] = [];

const reply = (text: string): ProviderResponse => ({
  text,
  toolUses: [],
  stopReason: "end_turn",
  model: "test-model",
  usage: { inputTokens: 0, outputTokens: 0 },
  raw: [],
});

const callTools = (
  calls: { name: string; input?: unknown }[]
): ProviderResponse => ({
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
      generate: async (request: ProviderRequest) => {
        seenRequests.push(request);
        return queued.shift() ?? reply("done");
      },
    }),
  };
});

const { handleTurn } = await import("../../server/ai/orchestrator");
const { listTools } = await import("../../server/ai/toolRegistry");
const { registerTools } = await import("../../server/ai/tools/index");

// handleTurn registers on first use; the description checks below read the
// registry directly, so populate it up front.
registerTools();

const ctx: ToolContext = {
  userId: "uid-1",
  userEmail: "manager@example.com",
  role: "hotel_admin",
  hotelId: "hotel-a",
  conversationId: "conv-1",
};

beforeEach(() => {
  queued.length = 0;
  seenRequests.length = 0;
  reads.bookings = 0;
  reads.rooms = 0;
  reads.metrics = 0;
});

describe("repeated calls are not repeated work", () => {
  it("serves an identical call from the earlier result", async () => {
    queued.push(
      callTools([{ name: "get_occupancy" }]),
      callTools([{ name: "get_occupancy" }]),
      reply("Occupancy is 0%.")
    );
    const result = await handleTurn(ctx, "occupancy? and again?");

    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls[0].reusedEarlierResult).toBeUndefined();
    expect(result.toolCalls[1].reusedEarlierResult).toBe(true);
    // Both calls are still recorded — the audit trail shows what the model
    // asked for, not a tidied-up version.
    expect(result.toolCalls.every((call) => call.status === "ok")).toBe(true);
  });

  it("treats defaulted and explicit arguments as the same call", async () => {
    queued.push(
      callTools([{ name: "get_revenue", input: {} }]),
      callTools([{ name: "get_revenue", input: { period: "today" } }]),
      reply("Revenue is nil.")
    );
    const result = await handleTurn(ctx, "revenue today?");

    expect(result.toolCalls[1].reusedEarlierResult).toBe(true);
    expect(reads.metrics).toBe(1);
  });

  it("does not conflate different arguments", async () => {
    queued.push(
      callTools([
        { name: "get_revenue", input: { period: "today" } },
        { name: "get_revenue", input: { period: "month" } },
      ]),
      reply("Both.")
    );
    const result = await handleTurn(ctx, "today vs this month");

    expect(result.toolCalls.some((call) => call.reusedEarlierResult)).toBe(false);
  });

  it("does not cache a failed call as its answer", async () => {
    queued.push(
      callTools([{ name: "get_revenue", input: { period: "nonsense" } }]),
      callTools([{ name: "get_revenue", input: { period: "nonsense" } }]),
      reply("Could not read that.")
    );
    const result = await handleTurn(ctx, "revenue for nonsense");

    expect(result.toolCalls.every((call) => call.status === "error")).toBe(true);
    expect(result.toolCalls.some((call) => call.reusedEarlierResult)).toBe(false);
  });
});

describe("one turn, one read", () => {
  it("shares a Firestore read between tools that need the same data", async () => {
    // Both tools read bookings; occupancy also reads rooms.
    queued.push(
      callTools([{ name: "get_occupancy" }, { name: "get_check_ins" }]),
      reply("All quiet.")
    );
    await handleTurn(ctx, "how are we looking?");

    expect(reads.bookings).toBe(1);
    expect(reads.rooms).toBe(1);
  });

  it("starts a fresh read for the next turn", async () => {
    queued.push(callTools([{ name: "get_occupancy" }]), reply("ok"));
    await handleTurn(ctx, "occupancy?");
    expect(reads.rooms).toBe(1);

    queued.push(callTools([{ name: "get_occupancy" }]), reply("ok"));
    await handleTurn(ctx, "occupancy again?");
    // A new question sees current data, not the last turn's snapshot.
    expect(reads.rooms).toBe(2);
  });
});

describe("call budget", () => {
  it("caps how much one question can cost", async () => {
    const six = Array.from({ length: 6 }, (_, i) => ({
      name: "get_revenue",
      input: { period: i % 2 ? "today" : "month" },
    }));
    queued.push(callTools(six), callTools(six), reply("Enough."));

    const result = await handleTurn(ctx, "everything, repeatedly");

    const refused = result.toolCalls.filter((call) =>
      call.errorMessage?.match(/budget/i)
    );
    const ran = result.toolCalls.length - refused.length;

    // The cap bounds work done, not what gets recorded: refusals stay in the
    // record so the turn's real cost and the model's real asks are both visible.
    expect(ran).toBeLessThanOrEqual(8);
    expect(refused.length).toBeGreaterThan(0);
    expect(refused[0].durationMs).toBe(0);
  });
});

describe("tool descriptions steer the choice", () => {
  const tools = listTools();

  it("registers every tool exactly once, with a unique name", () => {
    const names = tools.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.length).toBeGreaterThanOrEqual(10);
  });

  it("tells the model when each tool applies", () => {
    for (const tool of tools) {
      expect(tool.description, `${tool.name} has no USE FOR`).toMatch(/USE FOR/);
      expect(tool.description.length, `${tool.name} description too short`)
        .toBeGreaterThan(120);
    }
  });

  it("marks the report as the one call for a broad question", () => {
    const report = tools.find((tool) => tool.name === "generate_report")!;
    expect(report.description).toMatch(/PREFER THIS/);
    expect(report.description).toMatch(/get_occupancy/);
  });

  it("stops the revenue tools from being called together", () => {
    const revenue = tools.find((tool) => tool.name === "get_revenue")!;
    expect(revenue.description).toMatch(/do not also call/i);

    for (const name of ["get_restaurant_sales", "get_conference_revenue", "get_expenses"]) {
      expect(tools.find((tool) => tool.name === name)!.description).toMatch(
        /NOT FOR/
      );
    }
  });

  it("gives the model the same guidance in the system prompt", async () => {
    queued.push(reply("ok"));
    await handleTurn(ctx, "hello");

    const { system } = seenRequests[0];
    expect(system).toMatch(/fewest tools/i);
    expect(system).toMatch(/generate_report once/i);
    expect(system).toMatch(/Do not call a tool twice with the same arguments/i);
  });
});
