/**
 * Front-desk tools: arrivals, departures, and the reservation book.
 *
 * Arrivals and departures read the combined booking sources (legacy
 * `accomodation` plus `reservations`), because a hotel mid-migration has
 * guests in both. `get_reservations` reads only `reservations` — that is
 * the collection the front-desk flow writes and the one a question about
 * "the reservation book" means.
 *
 * Dates are compared with `toPMSDate`/`isSameDay` from src/lib/pms.ts, the
 * same helpers the Front Desk page uses, so "arriving today" means the
 * same thing in both places.
 */
import type { ToolDefinition } from "../../types";
import { STAFF_AND_ADMIN } from "../roles";
import { fetchBookings, fetchReservations } from "../dataAccess";
import {
  optionalDate,
  optionalEnum,
  optionalInt,
  strictObject,
} from "../validation";
import { isSameDay, toPMSDate } from "../../../../src/lib/pms";
import { bookingStatusOf, type BookingRecord } from "../../../../src/lib/metrics";
import type { BookingStatus } from "../../../../src/lib/collections";

const dateSchema = {
  type: "object",
  properties: {
    date: {
      type: "string",
      description: "Calendar date as YYYY-MM-DD. Defaults to today.",
    },
  },
  additionalProperties: false,
} as const;

interface DateInput {
  date: Date;
  isToday: boolean;
}

function parseDateInput(raw: unknown): DateInput {
  const date = optionalDate(strictObject(raw, ["date"]), "date");
  const today = new Date();
  return { date: date ?? today, isToday: !date || isSameDay(date, today) };
}

/** See MAX_ROOMS_RETURNED in read/rooms.ts — same reasoning. */
const MAX_MOVEMENTS_RETURNED = 100;

function truncationNote(total: number, shown: number): string | undefined {
  return total > shown ? `Showing ${shown} of ${total}.` : undefined;
}

function describeBooking(booking: BookingRecord) {
  const checkIn = toPMSDate(booking.checkIn as never);
  const checkOut = toPMSDate(booking.checkOut as never);
  return {
    guestName: booking.guestName ?? "(no name recorded)",
    roomNumber: booking.roomNumber ? String(booking.roomNumber) : "(unassigned)",
    roomType: booking.roomType,
    status: bookingStatusOf(booking),
    checkIn: checkIn?.toISOString(),
    checkOut: checkOut?.toISOString(),
    paymentStatus: booking.paymentStatus,
    amount: Number(booking.pricePaid) || 0,
  };
}

/** Cancelled and no-show bookings are not operational work for the desk. */
function isLive(status: BookingStatus): boolean {
  return status !== "Cancelled" && status !== "No Show";
}

export const getCheckIns: ToolDefinition<DateInput, unknown> = {
  name: "get_check_ins",
  description:
    "Arrivals for ONE day (today by default): who is due in, their room, " +
    "status and payment status. Cancelled and no-shows excluded. " +
    "USE FOR: 'who is arriving today', 'how many check-ins tomorrow', " +
    "'arrivals on the 14th'. " +
    "NOT FOR: a forward-looking list across many days (get_reservations with " +
    "window 'upcoming').",
  allowedRoles: STAFF_AND_ADMIN,
  isWrite: false,
  inputSchema: dateSchema,
  validateInput: parseDateInput,
  handler: async (ctx, input) => {
    const bookings = await fetchBookings(ctx.hotelId as string);
    const arrivals = bookings
      .filter((booking) => isLive(bookingStatusOf(booking)))
      .filter((booking) => isSameDay(toPMSDate(booking.checkIn as never), input.date))
      .map(describeBooking);

    return {
      date: input.date.toISOString().slice(0, 10),
      isToday: input.isToday,
      count: arrivals.length,
      stillExpected: arrivals.filter((a) => a.status === "Confirmed").length,
      alreadyCheckedIn: arrivals.filter((a) => a.status === "Checked In").length,
      truncated: truncationNote(arrivals.length, MAX_MOVEMENTS_RETURNED),
      arrivals: arrivals.slice(0, MAX_MOVEMENTS_RETURNED),
    };
  },
};

export const getCheckOuts: ToolDefinition<DateInput, unknown> = {
  name: "get_check_outs",
  description:
    "Departures for ONE day (today by default): who is due out, their room, " +
    "status, payment status, and how many still owe. Cancelled and no-shows " +
    "excluded. " +
    "USE FOR: 'who is checking out today', 'departures tomorrow', 'who leaves " +
    "with an unpaid balance'. " +
    "NOT FOR: guests currently in house (get_reservations with window " +
    "'in_house').",
  allowedRoles: STAFF_AND_ADMIN,
  isWrite: false,
  inputSchema: dateSchema,
  validateInput: parseDateInput,
  handler: async (ctx, input) => {
    const bookings = await fetchBookings(ctx.hotelId as string);
    const departures = bookings
      .filter((booking) => isLive(bookingStatusOf(booking)))
      .filter((booking) => isSameDay(toPMSDate(booking.checkOut as never), input.date))
      .map(describeBooking);

    return {
      date: input.date.toISOString().slice(0, 10),
      isToday: input.isToday,
      count: departures.length,
      stillInHouse: departures.filter((d) => d.status === "Checked In").length,
      alreadyCheckedOut: departures.filter((d) => d.status === "Checked Out").length,
      unpaid: departures.filter((d) => (d.paymentStatus ?? "").toLowerCase() === "pending")
        .length,
      truncated: truncationNote(departures.length, MAX_MOVEMENTS_RETURNED),
      departures: departures.slice(0, MAX_MOVEMENTS_RETURNED),
    };
  },
};

const WINDOWS = ["upcoming", "today", "in_house", "recent"] as const;
type Window = (typeof WINDOWS)[number];

interface ReservationsInput {
  window: Window;
  limit: number;
}

interface ReservationDoc {
  id: string;
  reservationNumber?: string;
  guestName?: string;
  roomNumber?: string;
  roomType?: string;
  status?: BookingStatus;
  checkIn?: unknown;
  checkOut?: unknown;
  numberOfGuests?: number;
  totalAmount?: number;
  depositAmount?: number;
  bookingSource?: string;
}

export const getReservations: ToolDefinition<ReservationsInput, unknown> = {
  name: "get_reservations",
  description:
    "The reservation book across days: upcoming (default), arriving today, " +
    "currently in house, or recently departed. " +
    "USE FOR: 'what's coming up', 'who is staying with us', 'show me the next " +
    "few bookings'. " +
    "NOT FOR: one specific day's arrivals or departures — get_check_ins and " +
    "get_check_outs answer those directly.",
  allowedRoles: STAFF_AND_ADMIN,
  isWrite: false,
  inputSchema: {
    type: "object",
    properties: {
      window: {
        type: "string",
        enum: [...WINDOWS],
        description:
          "Which slice of the book to return. Defaults to 'upcoming' (arriving from today onwards).",
      },
      limit: {
        type: "integer",
        description: "Maximum reservations to return, 1-50. Defaults to 20.",
      },
    },
    additionalProperties: false,
  },
  validateInput: (raw) => {
    const input = strictObject(raw, ["window", "limit"]);
    return {
      window: optionalEnum(input, "window", WINDOWS, "upcoming"),
      limit: optionalInt(input, "limit", { min: 1, max: 50, fallback: 20 }),
    };
  },
  handler: async (ctx, input) => {
    const reservations = await fetchReservations<ReservationDoc>(
      ctx.hotelId as string
    );
    const now = new Date();

    const matches = reservations.filter((reservation) => {
      const status = reservation.status ?? "Confirmed";
      const checkIn = toPMSDate(reservation.checkIn as never);
      const checkOut = toPMSDate(reservation.checkOut as never);

      switch (input.window) {
        case "today":
          return isLive(status) && isSameDay(checkIn, now);
        case "in_house":
          return status === "Checked In";
        case "recent":
          return !!checkOut && checkOut < now;
        case "upcoming":
        default:
          return isLive(status) && !!checkIn && (checkIn >= now || isSameDay(checkIn, now));
      }
    });

    const sorted = matches.sort((a, b) => {
      const aDate = toPMSDate(a.checkIn as never)?.getTime() ?? 0;
      const bDate = toPMSDate(b.checkIn as never)?.getTime() ?? 0;
      // Past-facing windows read newest-first; forward-looking ones soonest-first.
      return input.window === "recent" ? bDate - aDate : aDate - bDate;
    });

    return {
      window: input.window,
      totalMatching: sorted.length,
      returned: Math.min(sorted.length, input.limit),
      reservations: sorted.slice(0, input.limit).map((reservation) => ({
        reservationNumber: reservation.reservationNumber ?? reservation.id,
        guestName: reservation.guestName ?? "(no name recorded)",
        roomNumber: reservation.roomNumber,
        roomType: reservation.roomType,
        status: reservation.status ?? "Confirmed",
        checkIn: toPMSDate(reservation.checkIn as never)?.toISOString(),
        checkOut: toPMSDate(reservation.checkOut as never)?.toISOString(),
        guests: reservation.numberOfGuests,
        totalAmount: reservation.totalAmount,
        depositAmount: reservation.depositAmount,
        source: reservation.bookingSource,
      })),
    };
  },
};
