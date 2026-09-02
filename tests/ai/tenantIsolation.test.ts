/**
 * Property isolation for tools.
 *
 * On the client, firestore.rules enforce the tenant boundary. Tools run on
 * the Admin SDK, which bypasses those rules, so the boundary here is that
 * every read is parameterised by `ctx.hotelId` and by nothing else. These
 * tests mock the data layer and assert which hotel each tool actually asks
 * for — including when the model tries to name a different one.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchBookings = vi.fn(async () => []);
const fetchRooms = vi.fn(async () => []);
const fetchOrders = vi.fn(async () => []);
const fetchEvents = vi.fn(async () => []);
const fetchExpenses = vi.fn(async () => []);
const fetchReservations = vi.fn(async () => []);
const fetchRoomsWithIds = vi.fn(async () => []);
// Not a per-tool fetcher: the prompt names the hotel. Mocked so the module
// shape matches, but deliberately absent from `allFetchers` below.
const fetchHotelName = vi.fn(async () => null);
const fetchMetricsInput = vi.fn(async () => ({
  bookings: [],
  orders: [],
  events: [],
  expenses: [],
  rooms: [],
}));

/**
 * The write path's own accessors (Phase 10). A write tool resolves its
 * target by listing a collection, so it is parameterised by hotelId in
 * exactly the way a read is, and belongs in the same assertion.
 *
 * `listDocsUncached` returns the one room and the one reservation the
 * write tools look for, so their handlers get far enough to attempt the
 * update — a tool that threw "no such room" before touching the data
 * layer would pass this test without proving anything.
 */
const listDocsUncached = vi.fn(async (_hotelId: string, collection: string) =>
  collection === "rooms"
    ? [{ id: "room-1", number: "204", status: "Available" }]
    : [{ id: "res-1", reservationId: "R-1", guestName: "Ada", status: "Confirmed" }]
);
const readDocUncached = vi.fn(async () => null);
const updateDocFields = vi.fn(async () => undefined);

// Mocking the data layer keeps these tests off the network and, more to
// the point, lets them observe the hotelId each tool passes down.
vi.mock("../../server/ai/tools/dataAccess", () => ({
  fetchBookings,
  fetchRooms,
  fetchOrders,
  fetchEvents,
  fetchExpenses,
  fetchReservations,
  fetchRoomsWithIds,
  fetchMetricsInput,
  fetchHotelName,
  listDocsUncached,
  readDocUncached,
  updateDocFields,
}));

const { registerTools } = await import("../../server/ai/tools/index");
const { listTools } = await import("../../server/ai/toolRegistry");
const { ToolValidationError } = await import("../../server/ai/types");
import type { ToolContext } from "../../server/ai/types";

registerTools();

const HOTEL_A = "hotel-a";
const HOTEL_B = "hotel-b";

const ctxFor = (hotelId: string): ToolContext => ({
  userId: "uid-1",
  userEmail: "manager@hotel-a.example",
  role: "hotel_admin",
  hotelId,
  conversationId: "conv-1",
});

const allFetchers = [
  fetchBookings,
  fetchRooms,
  fetchOrders,
  fetchEvents,
  fetchExpenses,
  fetchReservations,
  fetchRoomsWithIds,
  fetchMetricsInput,
  listDocsUncached,
  readDocUncached,
  updateDocFields,
];

/**
 * Arguments that let each tool actually run. Reads mostly take none; a
 * write takes a target, and the point of this suite is where it looks for
 * that target, not whether it can be called with nothing.
 */
const VALID_INPUT: Record<string, Record<string, unknown>> = {
  update_room_status: { roomNumber: "204", status: "Cleaning" },
  update_reservation_status: { reservation: "R-1", status: "Checked In" },
};

beforeEach(() => {
  for (const fetcher of allFetchers) fetcher.mockClear();
});

/** Every hotelId any mocked fetcher was called with during a tool run. */
function hotelsQueried(): string[] {
  return allFetchers.flatMap((fetcher) =>
    fetcher.mock.calls.map((call) => call[0] as string)
  );
}

describe("every tool is scoped to the caller's hotel", () => {
  for (const tool of listTools()) {
    it(`${tool.name} reads only from ctx.hotelId`, async () => {
      const input = tool.validateInput(VALID_INPUT[tool.name] ?? {});
      // A write tool's summarize() resolves the target too, and does it
      // before any confirmation exists — so it is on the same boundary.
      if (tool.summarize) await tool.summarize(ctxFor(HOTEL_A), input);
      await tool.handler(ctxFor(HOTEL_A), input);

      const queried = hotelsQueried();
      expect(queried.length).toBeGreaterThan(0);
      expect(new Set(queried)).toEqual(new Set([HOTEL_A]));
      expect(queried).not.toContain(HOTEL_B);
    });
  }
});

describe("the model cannot redirect a tool at another property", () => {
  for (const tool of listTools()) {
    it(`${tool.name} refuses a supplied hotelId`, () => {
      // Rejected as an undeclared argument — the request never runs at all.
      // The tool's own valid arguments are included so the refusal is
      // provably about `hotelId`, and not just about a missing target.
      expect(() =>
        tool.validateInput({ ...(VALID_INPUT[tool.name] ?? {}), hotelId: HOTEL_B })
      ).toThrow(ToolValidationError);
    });
  }

  it("still reads the caller's hotel when the arguments are otherwise valid", async () => {
    const revenue = listTools().find((tool) => tool.name === "get_revenue")!;
    await revenue.handler(ctxFor(HOTEL_A), revenue.validateInput({ period: "month" }));

    expect(fetchMetricsInput).toHaveBeenCalledWith(HOTEL_A);
    expect(hotelsQueried()).not.toContain(HOTEL_B);
  });

  it("reads hotel B only when the context itself is hotel B", async () => {
    const occupancy = listTools().find((tool) => tool.name === "get_occupancy")!;
    await occupancy.handler(ctxFor(HOTEL_B), occupancy.validateInput({}));

    expect(new Set(hotelsQueried())).toEqual(new Set([HOTEL_B]));
  });
});
