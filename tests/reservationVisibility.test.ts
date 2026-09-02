/**
 * Reservation → room availability consistency.
 *
 * A stay can be created from three places: the PMS Reservations page, the
 * legacy Accommodation page, and a WebMCP agent. They do not all write to
 * the same collection — reservations go to hotels/{id}/reservations, legacy
 * bookings to hotels/{id}/accomodation — so every screen that answers "is
 * this room free?" has to read both. When one of them reads only its own
 * collection, a reservation exists in Firestore while a room still looks
 * available for the same nights, and the room can be double-booked.
 *
 * These tests run the real reservation service against an in-memory
 * Firestore. The emulator covers rules and persistence (tests/rules);
 * what is checked here is the availability rule itself, which is where the
 * cross-collection bug lived.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ------------------------------------------------------------ fake Firestore
type DocData = Record<string, unknown>;
const store = new Map<string, Map<string, DocData>>();

class FakeTimestamp {
  constructor(private readonly date: Date) {}
  static fromDate(date: Date) {
    return new FakeTimestamp(date);
  }
  toDate() {
    return this.date;
  }
}

let autoId = 0;

vi.mock("../firebase", () => ({ db: {}, auth: { currentUser: null } }));

vi.mock("firebase/firestore", () => {
  const path = (segments: unknown[]) => segments.filter((s) => typeof s === "string").join("/");
  return {
    collection: (_db: unknown, ...segments: string[]) => ({ path: path(segments) }),
    doc: (_db: unknown, ...segments: string[]) => {
      const full = path(segments);
      const parts = full.split("/");
      return { path: full, id: parts[parts.length - 1], collectionPath: parts.slice(0, -1).join("/") };
    },
    addDoc: async (ref: { path: string }, data: DocData) => {
      const id = `doc-${++autoId}`;
      const docs = store.get(ref.path) ?? new Map<string, DocData>();
      docs.set(id, data);
      store.set(ref.path, docs);
      return { id };
    },
    getDoc: async (ref: { collectionPath: string; id: string }) => {
      const data = store.get(ref.collectionPath)?.get(ref.id);
      return { exists: () => data !== undefined, data: () => data, id: ref.id };
    },
    getDocs: async (ref: { path: string }) => {
      const docs = [...(store.get(ref.path) ?? new Map()).entries()].map(([id, data]) => ({
        id,
        data: () => data,
      }));
      return { docs, size: docs.length };
    },
    updateDoc: async (ref: { collectionPath: string; id: string }, patch: DocData) => {
      const existing = store.get(ref.collectionPath)?.get(ref.id);
      if (!existing) throw Object.assign(new Error("No document to update"), { code: "not-found" });
      Object.assign(existing, patch);
    },
    serverTimestamp: () => new FakeTimestamp(new Date()),
    Timestamp: FakeTimestamp,
  };
});

// Imported after the mocks so the service binds to the fake SDK.
const { createReservation, loadReservationContext } = await import("../src/lib/reservationService");
const { availableRoomsForStay, bookingOverlaps, roomBookingState } = await import("../src/lib/pms");

const HOTEL = "hotel-a";
const OTHER_HOTEL = "hotel-b";
const STAY = { checkIn: "2026-10-01", checkOut: "2026-10-04" };
const start = new Date("2026-10-01T14:00:00");
const end = new Date("2026-10-04T11:00:00");
/** A night inside the stay above. */
const overlapStart = new Date("2026-10-02T14:00:00");
const overlapEnd = new Date("2026-10-03T11:00:00");

const seedRoom = (hotelId: string, number: string, status = "Available") => {
  const rooms = store.get(`hotels/${hotelId}/rooms`) ?? new Map<string, DocData>();
  rooms.set(`room-${hotelId}-${number}`, { number, type: "Double", price: 150000, status });
  store.set(`hotels/${hotelId}/rooms`, rooms);
};

/** A legacy accomodation record, written the way the Accommodation page writes one. */
const seedLegacyBooking = (hotelId: string, booking: DocData) => {
  const docs = store.get(`hotels/${hotelId}/accomodation`) ?? new Map<string, DocData>();
  docs.set(`legacy-${docs.size + 1}`, booking);
  store.set(`hotels/${hotelId}/accomodation`, docs);
};

beforeEach(() => {
  store.clear();
  autoId = 0;
  store.set("hotels", new Map([[HOTEL, { name: "Hotel A" }], [OTHER_HOTEL, { name: "Hotel B" }]]));
  seedRoom(HOTEL, "101");
  seedRoom(HOTEL, "102");
  seedRoom(OTHER_HOTEL, "101");
});

/** The path both the Reservations page and innpilot_create_reservation take. */
const createStay = async (hotelId = HOTEL, roomNumber = "101", guestName = "Agent Guest") =>
  createReservation({
    hotelId,
    uid: "staff-a",
    guestName,
    roomNumber,
    ...STAY,
    bookingSource: "Direct",
    context: await loadReservationContext(hotelId),
  });

/** Every stay holding inventory, as each availability surface must read it. */
const allStays = async (hotelId = HOTEL) => {
  const ctx = await loadReservationContext(hotelId);
  return [...ctx.reservations, ...ctx.legacyBookings];
};

describe("a reservation blocks its room wherever availability is computed", () => {
  it("persists and reads back without touching the room's physical status", async () => {
    const result = await createStay();
    expect(result.ok).toBe(true);

    const ctx = await loadReservationContext(HOTEL);
    expect(ctx.reservations).toHaveLength(1);
    expect(ctx.reservations[0].roomNumber).toBe("101");
    // The room document is inventory, not a booking ledger: it stays as it was.
    expect(ctx.rooms.find((r) => r.number === "101")?.status).toBe("Available");
  });

  it("blocks the room for overlapping dates and leaves other rooms free", async () => {
    await createStay(HOTEL, "101");
    const stays = await allStays();
    const rooms = (await loadReservationContext(HOTEL)).rooms;

    expect(bookingOverlaps("101", overlapStart, overlapEnd, stays)).toBeDefined();
    expect(availableRoomsForStay(rooms, overlapStart, overlapEnd, stays).map((r) => r.number)).toEqual([
      "102",
    ]);
  });

  it("still frees the room for a stay that only touches it end to end", async () => {
    await createStay(HOTEL, "101");
    const stays = await allStays();
    // Arrives the morning the previous guest leaves.
    expect(
      bookingOverlaps("101", new Date("2026-10-04T14:00:00"), new Date("2026-10-06T11:00:00"), stays)
    ).toBeUndefined();
  });

  it("rejects a second reservation over the same room and nights", async () => {
    expect((await createStay(HOTEL, "101")).ok).toBe(true);
    const second = await createStay(HOTEL, "101", "Second Guest");
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toMatch(/already reserved/i);
    expect((await loadReservationContext(HOTEL)).reservations).toHaveLength(1);
  });

  it("counts a legacy accomodation booking made from the Accommodation page", async () => {
    seedLegacyBooking(HOTEL, {
      roomNumber: "102",
      guestName: "Walk-in Guest",
      status: "Confirmed",
      checkIn: FakeTimestamp.fromDate(start),
      checkOut: FakeTimestamp.fromDate(end),
    });

    const blocked = await createStay(HOTEL, "102");
    expect(blocked.ok).toBe(false);
    expect(bookingOverlaps("102", overlapStart, overlapEnd, await allStays())).toBeDefined();
  });

  it("counts a pre-migration legacy booking that has no status field", async () => {
    // Records written before `status` existed carry occupancy in isOccupied.
    seedLegacyBooking(HOTEL, {
      roomNumber: "102",
      guestName: "Legacy Guest",
      isOccupied: true,
      checkIn: FakeTimestamp.fromDate(start),
      checkOut: FakeTimestamp.fromDate(end),
    });

    expect(bookingOverlaps("102", overlapStart, overlapEnd, await allStays())).toBeDefined();
    expect((await createStay(HOTEL, "102")).ok).toBe(false);
  });

  it("ignores cancelled and no-show reservations", async () => {
    const created = await createStay(HOTEL, "101");
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const reservations = store.get(`hotels/${HOTEL}/reservations`)!;
    reservations.get(created.data.id)!.status = "Cancelled";

    expect(bookingOverlaps("101", overlapStart, overlapEnd, await allStays())).toBeUndefined();
    expect((await createStay(HOTEL, "101", "Replacement Guest")).ok).toBe(true);
  });

  it("keeps each hotel's inventory to itself", async () => {
    await createStay(HOTEL, "101");

    const otherCtx = await loadReservationContext(OTHER_HOTEL);
    expect(otherCtx.reservations).toHaveLength(0);
    // Hotel B's room 101 is a different room and stays bookable.
    expect(
      availableRoomsForStay(otherCtx.rooms, overlapStart, overlapEnd, [
        ...otherCtx.reservations,
        ...otherCtx.legacyBookings,
      ]).map((r) => r.number)
    ).toEqual(["101"]);
  });
});

describe("a room's physical status and its bookings stay separate facts", () => {
  const now = new Date("2026-10-02T09:00:00");

  it("reports a future reservation without claiming the room is occupied", async () => {
    await createStay(HOTEL, "101");
    const state = roomBookingState("101", await allStays(), new Date("2026-09-20T09:00:00"));

    expect(state.nextReservation).toBeDefined();
    expect(state.inHouse).toBeUndefined();
    expect(state.arrivingToday).toBeUndefined();
  });

  it("reports an arrival on its check-in day as due in, not in-house", async () => {
    await createStay(HOTEL, "101");
    const state = roomBookingState("101", await allStays(), new Date("2026-10-01T09:00:00"));

    expect(state.arrivingToday?.guestName).toBe("Agent Guest");
    expect(state.inHouse).toBeUndefined();
  });

  it("reports a checked-in guest as in-house", async () => {
    const created = await createStay(HOTEL, "101");
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    store.get(`hotels/${HOTEL}/reservations`)!.get(created.data.id)!.status = "Checked In";

    const state = roomBookingState("101", await allStays(), now);
    expect(state.inHouse?.guestName).toBe("Agent Guest");
    expect(state.nextReservation).toBeUndefined();
  });

  it("says nothing about a room with no bookings", async () => {
    expect(roomBookingState("102", await allStays(), now)).toEqual({
      inHouse: undefined,
      arrivingToday: undefined,
      nextReservation: undefined,
    });
  });
});
