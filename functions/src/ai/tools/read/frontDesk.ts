/**
 * Front-desk and room tools.
 *
 * Arrivals, departures, in-house and unsettled balances use the *exact*
 * definitions in `src/pages/pms/FrontDesk.tsx`, over the same
 * `reservations` collection that page reads:
 *
 *   arrivals    = status "Confirmed"  AND checkIn  is today
 *   departures  = status "Checked In" AND checkOut is today
 *   in-house    = status "Checked In"
 *   unsettled   = Confirmed/Checked In with paymentStatus != "Paid"
 *
 * Deliberately not "improved" here: a manager comparing the assistant with
 * the Front Desk screen must see the same counts. Date comparisons go
 * through `toPMSDate`/`isSameDay` from `src/lib/pms.ts` for the same
 * reason.
 */
import { isSameDay, toPMSDate } from "../../../../../src/lib/pms";
import { ROOM_STATUSES } from "../../../../../src/lib/collections";
import type { BookingDoc } from "../../data/hotelData";
import type { ToolDefinition } from "../../types";
import {
  DAY_SCHEMA,
  EMPTY_SCHEMA,
  resolveDay,
  validateDayInput,
  validateNoInput,
  type DayInput,
} from "../inputs";

const ALL_STAFF = ["hotel_admin", "staff"] as const;

/** Guest-facing summary of one reservation. Only operationally useful fields. */
function summarise(booking: BookingDoc) {
  return {
    id: booking.id,
    guestName: booking.guestName ?? null,
    roomNumber: booking.roomNumber ?? null,
    roomType: booking.roomType ?? null,
    status: booking.status ?? null,
    checkIn: toPMSDate(booking.checkIn as never)?.toISOString() ?? null,
    checkOut: toPMSDate(booking.checkOut as never)?.toISOString() ?? null,
    paymentStatus: booking.paymentStatus ?? null,
  };
}

export const getCheckIns: ToolDefinition<DayInput> = {
  name: "get_check_ins",
  description:
    "Guests arriving (checking in) on a given day: confirmed reservations whose check-in date is that day. Defaults to today. Same definition as the Front Desk screen.",
  inputSchema: DAY_SCHEMA,
  allowedRoles: [...ALL_STAFF],
  isWrite: false,
  validateInput: validateDayInput,
  async handler(_ctx, input, deps) {
    const day = resolveDay(input, deps.now);
    const reservations = await deps.data.reservations();
    const arrivals = reservations.filter(
      (b) => b.status === "Confirmed" && isSameDay(toPMSDate(b.checkIn as never), day)
    );

    return {
      date: day.toISOString().slice(0, 10),
      count: arrivals.length,
      arrivals: arrivals.map(summarise),
      source: "reservations (front-desk flow)",
    };
  },
};

export const getCheckOuts: ToolDefinition<DayInput> = {
  name: "get_check_outs",
  description:
    "Guests departing (checking out) on a given day: checked-in reservations whose check-out date is that day. Defaults to today. Same definition as the Front Desk screen.",
  inputSchema: DAY_SCHEMA,
  allowedRoles: [...ALL_STAFF],
  isWrite: false,
  validateInput: validateDayInput,
  async handler(_ctx, input, deps) {
    const day = resolveDay(input, deps.now);
    const reservations = await deps.data.reservations();
    const departures = reservations.filter(
      (b) => b.status === "Checked In" && isSameDay(toPMSDate(b.checkOut as never), day)
    );

    return {
      date: day.toISOString().slice(0, 10),
      count: departures.length,
      departures: departures.map(summarise),
      source: "reservations (front-desk flow)",
    };
  },
};

export const getRoomStatus: ToolDefinition<Record<string, never>> = {
  name: "get_room_status",
  description:
    "Live status of every room in the hotel (Available, Occupied, Cleaning, Maintenance, Out of Service), with counts per status and the list of rooms.",
  inputSchema: EMPTY_SCHEMA,
  allowedRoles: [...ALL_STAFF],
  isWrite: false,
  validateInput: validateNoInput,
  async handler(_ctx, _input, deps) {
    const rooms = await deps.data.rooms();

    const counts: Record<string, number> = {};
    for (const status of ROOM_STATUSES) counts[status] = 0;
    for (const room of rooms) {
      const status = room.status ?? "Unknown";
      counts[status] = (counts[status] ?? 0) + 1;
    }

    return {
      totalRooms: rooms.length,
      countsByStatus: counts,
      rooms: rooms
        .map((room) => ({
          number: room.number ?? null,
          type: room.type ?? null,
          status: room.status ?? null,
        }))
        .sort((a, b) => String(a.number).localeCompare(String(b.number), undefined, { numeric: true })),
      note:
        rooms.length === 0
          ? "No rooms are registered for this hotel."
          : "Live room status as recorded in InnPilot.",
    };
  },
};

export const getInHouseGuests: ToolDefinition<Record<string, never>> = {
  name: "get_in_house_guests",
  description:
    "Guests currently in house (reservations with status 'Checked In'), plus the total unsettled balance across confirmed and in-house reservations. Same definition as the Front Desk screen.",
  inputSchema: EMPTY_SCHEMA,
  allowedRoles: [...ALL_STAFF],
  isWrite: false,
  validateInput: validateNoInput,
  async handler(_ctx, _input, deps) {
    const reservations = await deps.data.reservations();
    const inHouse = reservations.filter((b) => b.status === "Checked In");

    // Mirrors FrontDesk.tsx exactly, including its use of `pricePaid`.
    const unsettled = reservations
      .filter((b) => b.status === "Checked In" || b.status === "Confirmed")
      .reduce(
        (sum, b) => sum + (b.paymentStatus === "Paid" ? 0 : Number(b.pricePaid || 0)),
        0
      );

    return {
      inHouseCount: inHouse.length,
      guests: inHouse.map(summarise),
      currency: "UGX",
      unsettledBalance: unsettled,
      source: "reservations (front-desk flow)",
    };
  },
};
