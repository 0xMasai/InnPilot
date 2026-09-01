/**
 * Room-state tools: what the hotel looks like right now.
 *
 * Point-in-time, so neither takes a period. Both read the same `rooms`
 * collection the Room Board renders, and derive occupancy with
 * `occupancyRate` from src/lib/pms.ts — the app's own definition, so the
 * assistant and the dashboard cannot drift apart.
 */
import type { ToolDefinition } from "../../types";
import { STAFF_AND_ADMIN } from "../roles";
import { fetchBookings, fetchRoomsWithIds } from "../dataAccess";
import { optionalEnum, strictObject } from "../validation";
import { occupancyRate } from "../../../../src/lib/pms";
import { ROOM_STATUSES, type RoomStatus } from "../../../../src/lib/collections";
import { bookingStatusOf, type BookingRecord } from "../../../../src/lib/metrics";

interface RoomDoc {
  number?: string;
  type?: string;
  status?: RoomStatus;
}

/** Rooms whose guest is currently in the building. */
function guestByRoom(bookings: BookingRecord[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const booking of bookings) {
    if (bookingStatusOf(booking) !== "Checked In") continue;
    const room = String(booking.roomNumber ?? "");
    if (room) map.set(room, booking.guestName ?? "In-house guest");
  }
  return map;
}

export const getOccupancy: ToolDefinition<Record<string, never>, unknown> = {
  name: "get_occupancy",
  description:
    "Occupancy right now: counts of rooms occupied, available, being cleaned, " +
    "under maintenance or out of service, plus the occupancy rate and how " +
    "many guests are in house. " +
    "USE FOR: 'what's our occupancy', 'how full are we', 'how many rooms are free'. " +
    "NOT FOR: a list of which specific rooms (get_room_status), occupancy over " +
    "a past period (this is current state only), or money (get_revenue).",
  allowedRoles: STAFF_AND_ADMIN,
  isWrite: false,
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  validateInput: (raw) => {
    strictObject(raw, []);
    return {} as Record<string, never>;
  },
  handler: async (ctx) => {
    const hotelId = ctx.hotelId as string;
    const [rooms, bookings] = await Promise.all([
      fetchRoomsWithIds<RoomDoc>(hotelId),
      fetchBookings(hotelId),
    ]);

    const byStatus: Record<string, number> = {};
    for (const status of ROOM_STATUSES) byStatus[status] = 0;
    for (const room of rooms) {
      if (room.status) byStatus[room.status] = (byStatus[room.status] ?? 0) + 1;
    }

    const occupied = byStatus["Occupied"] ?? 0;
    const inHouse = guestByRoom(bookings).size;

    return {
      totalRooms: rooms.length,
      occupied,
      available: byStatus["Available"] ?? 0,
      occupancyRatePercent: rooms.length ? occupancyRate(occupied, rooms.length) : null,
      roomsByStatus: byStatus,
      inHouseGuests: inHouse,
      // Rooms marked Occupied and guests marked Checked In are recorded
      // separately in this system and can disagree; say so rather than
      // presenting one as the other.
      note:
        occupied === inHouse
          ? undefined
          : "Room status and checked-in bookings disagree; the front desk may have work outstanding.",
      asOf: new Date().toISOString(),
    };
  },
};

const ROOM_FILTERS = ["all", ...ROOM_STATUSES] as const;

/**
 * Cap on rooms returned in one call. A list is data the model pays for in
 * context on every subsequent round, so it is bounded here rather than
 * left to grow with the property; the count fields above stay exact.
 */
const MAX_ROOMS_RETURNED = 100;

export const getRoomStatus: ToolDefinition<{ filter: string }, unknown> = {
  name: "get_room_status",
  description:
    "The room-by-room list: number, type, status, and the in-house guest " +
    "where there is one. Optionally filtered to a single status. " +
    "USE FOR: 'which rooms need cleaning', 'is room 204 free', 'list the " +
    "occupied rooms'. " +
    "NOT FOR: just the totals or the occupancy rate — get_occupancy already " +
    "returns those, and costs less than a list you have to count.",
  allowedRoles: STAFF_AND_ADMIN,
  isWrite: false,
  inputSchema: {
    type: "object",
    properties: {
      filter: {
        type: "string",
        enum: [...ROOM_FILTERS],
        description: "Restrict the list to one room status. Defaults to 'all'.",
      },
    },
    additionalProperties: false,
  },
  validateInput: (raw) => ({
    filter: optionalEnum(strictObject(raw, ["filter"]), "filter", ROOM_FILTERS, "all"),
  }),
  handler: async (ctx, input) => {
    const hotelId = ctx.hotelId as string;
    const [rooms, bookings] = await Promise.all([
      fetchRoomsWithIds<RoomDoc>(hotelId),
      fetchBookings(hotelId),
    ]);

    const guests = guestByRoom(bookings);
    const selected =
      input.filter === "all"
        ? rooms
        : rooms.filter((room) => room.status === input.filter);

    const listed = selected.slice(0, MAX_ROOMS_RETURNED);

    return {
      filter: input.filter,
      count: selected.length,
      totalRooms: rooms.length,
      truncated:
        selected.length > listed.length
          ? `Showing ${listed.length} of ${selected.length} matching rooms.`
          : undefined,
      rooms: listed
        .map((room) => ({
          number: room.number ?? "(unnumbered)",
          type: room.type ?? "Room",
          status: room.status ?? "(unset)",
          guest: guests.get(String(room.number ?? "")),
        }))
        .sort((a, b) =>
          a.number.localeCompare(b.number, undefined, { numeric: true })
        ),
    };
  },
};
