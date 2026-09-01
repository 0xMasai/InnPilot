/**
 * Test fixtures.
 *
 * `fakeHotelData` records which hotel it was asked for and returns data
 * only for that hotel — so a test can prove a tool never reaches outside
 * the hotel in its ToolContext, without needing a Firestore emulator.
 */
import type { HotelData, BookingDoc, RoomDoc } from "../src/ai/data/hotelData";
import type { Role, ToolContext, ToolDeps } from "../src/ai/types";

export const NOW = new Date("2026-09-01T10:00:00Z");

export function ctxFor(role: Role, hotelId: string | null = "hotel-a"): ToolContext {
  return {
    userId: "user-1",
    userEmail: "manager@example.com",
    role,
    hotelId: role === "super_admin" ? null : hotelId,
    conversationId: "conv-1",
  };
}

const HOTEL_A_ROOMS: RoomDoc[] = [
  { id: "r1", number: "101", type: "Standard", status: "Occupied" },
  { id: "r2", number: "102", type: "Standard", status: "Available" },
];

const HOTEL_B_ROOMS: RoomDoc[] = [
  { id: "r9", number: "999", type: "SECRET-B", status: "Occupied" },
];

const HOTEL_A_RESERVATIONS: BookingDoc[] = [
  {
    id: "res1",
    guestName: "Amina Nakato",
    roomNumber: "101",
    roomType: "Deluxe",
    status: "Checked In",
    checkIn: new Date("2026-08-30T12:00:00Z"),
    checkOut: new Date("2026-09-01T11:00:00Z"),
    pricePaid: 250000,
    paymentStatus: "Paid",
    // Fields a tool must never surface — see the exposure tests.
    guestPhoneNumber: "+256700000000",
    notes: "Guest is a VIP; card ending 4242 on file.",
    createdBy: "staff-uid-7",
    guestId: "guest-abc",
  } as BookingDoc & Record<string, unknown>,
];

const HOTEL_B_RESERVATIONS: BookingDoc[] = [
  {
    id: "resB",
    guestName: "OTHER HOTEL GUEST",
    roomNumber: "999",
    status: "Checked In",
    checkIn: new Date("2026-08-30T12:00:00Z"),
    checkOut: new Date("2026-09-09T11:00:00Z"),
    pricePaid: 99999999,
  },
];

export interface FakeData extends HotelData {
  /** Every hotelId this loader was constructed for. */
  readonly requestedHotelId: string;
}

export function fakeHotelData(hotelId: string): FakeData {
  const isA = hotelId === "hotel-a";
  const rooms = isA ? HOTEL_A_ROOMS : HOTEL_B_ROOMS;
  const reservations = isA ? HOTEL_A_RESERVATIONS : HOTEL_B_RESERVATIONS;
  const expenses = isA
    ? [{ amount: 120000, department: "Kitchen", createdAt: NOW }]
    : [{ amount: 77777777, department: "SECRET-B-DEPARTMENT", createdAt: NOW }];
  const orders = isA
    ? [{ price: 45000, category: "Main Course", status: "Paid", createdAt: NOW }]
    : [{ price: 88888888, category: "SECRET-B-CATEGORY", status: "Paid", createdAt: NOW }];

  return {
    requestedHotelId: hotelId,
    bookings: async () => reservations,
    reservations: async () => reservations,
    orders: async () => orders,
    events: async () => [],
    expenses: async () => expenses,
    rooms: async () => rooms,
    metricsInput: async () => ({
      bookings: reservations,
      orders,
      events: [],
      expenses,
      rooms,
    }),
  };
}

export function depsFor(hotelId: string): ToolDeps {
  return { data: fakeHotelData(hotelId), now: NOW };
}
