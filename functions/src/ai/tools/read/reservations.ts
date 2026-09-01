/**
 * Reservation lookup tools.
 *
 * These read `reservations` — the live front-desk flow that
 * `Reservations.tsx`, `FrontDesk.tsx` and `RoomBoard.tsx` use. Revenue and
 * occupancy tools deliberately read a *wider* set (accommodation +
 * reservations, as the dashboards do), so a hotel still on the legacy
 * accommodation flow can have reservations tools return fewer records than
 * its revenue figures imply. Each result therefore states its `source`, so
 * the assistant can say which set it is describing rather than implying one
 * covers the other.
 */
import { toPMSDate } from "../../../../../src/lib/pms";
import { BOOKING_STATUSES, type BookingStatus } from "../../../../../src/lib/collections";
import type { BookingDoc } from "../../data/hotelData";
import { ToolValidationError } from "../../types";
import { HOTEL_STAFF_ROLES, defineReadTool } from "../defineTool";
import { cleanText } from "../sanitize";

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

interface ReservationQuery {
  status?: BookingStatus;
  guestName?: string;
  roomNumber?: string;
  limit?: number;
}

const RESERVATION_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    status: {
      type: "string",
      enum: [...BOOKING_STATUSES],
      description: "Only reservations with this status.",
    },
    guestName: {
      type: "string",
      description: "Case-insensitive partial match on guest name.",
    },
    roomNumber: { type: "string", description: "Exact room number." },
    limit: {
      type: "integer",
      description: `Maximum reservations to return (1-${MAX_LIMIT}, default ${DEFAULT_LIMIT}).`,
    },
  },
  required: [],
  additionalProperties: false,
};

const UPCOMING_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    days: {
      type: "integer",
      description: "How many days ahead to look (1-90, default 7).",
    },
    limit: {
      type: "integer",
      description: `Maximum reservations to return (1-${MAX_LIMIT}, default ${DEFAULT_LIMIT}).`,
    },
  },
  required: [],
  additionalProperties: false,
};

function asObject(raw: unknown, allowed: string[]): Record<string, unknown> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new ToolValidationError("Tool input must be an object.");
  }
  const input = raw as Record<string, unknown>;
  const unknown = Object.keys(input).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new ToolValidationError(
      `Unknown parameter(s): ${unknown.join(", ")}. Allowed: ${allowed.join(", ")}.`
    );
  }
  return input;
}

function boundedInt(
  value: unknown,
  name: string,
  min: number,
  max: number,
  fallback: number
): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new ToolValidationError(`'${name}' must be an integer.`);
  }
  if (value < min || value > max) {
    throw new ToolValidationError(`'${name}' must be between ${min} and ${max}.`);
  }
  return value;
}

function shortString(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new ToolValidationError(`'${name}' must be a string.`);
  }
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > 100) {
    throw new ToolValidationError(`'${name}' is too long (max 100 characters).`);
  }
  return trimmed;
}

function detail(booking: BookingDoc) {
  return {
    id: booking.id,
    reservationNumber: cleanText(booking.reservationNumber),
    guestName: cleanText(booking.guestName),
    roomNumber: cleanText(booking.roomNumber),
    roomType: cleanText(booking.roomType),
    status: booking.status ?? null,
    checkIn: toPMSDate(booking.checkIn as never)?.toISOString() ?? null,
    checkOut: toPMSDate(booking.checkOut as never)?.toISOString() ?? null,
    paymentStatus: booking.paymentStatus ?? null,
    numberOfGuests: booking.numberOfGuests ?? null,
    bookingSource: cleanText(booking.bookingSource),
  };
}

export const getReservations = defineReadTool<ReservationQuery, unknown>({
  name: "get_reservations",
  description:
    "Look up reservations in the front-desk system, optionally filtered by status, guest name or room number. Returns the most recent check-in dates first.",
  inputSchema: RESERVATION_SCHEMA,
  allowedRoles: [...HOTEL_STAFF_ROLES],
  validateInput(raw) {
    const input = asObject(raw, ["status", "guestName", "roomNumber", "limit"]);

    const status = input.status;
    if (status !== undefined && status !== null) {
      if (typeof status !== "string" || !BOOKING_STATUSES.includes(status as BookingStatus)) {
        throw new ToolValidationError(
          `'status' must be one of: ${BOOKING_STATUSES.join(", ")}.`
        );
      }
    }

    return {
      status: (status as BookingStatus | undefined) ?? undefined,
      guestName: shortString(input.guestName, "guestName"),
      roomNumber: shortString(input.roomNumber, "roomNumber"),
      limit: boundedInt(input.limit, "limit", 1, MAX_LIMIT, DEFAULT_LIMIT),
    };
  },
  async handler(_ctx, input, deps) {
    const reservations = await deps.data.reservations();
    const needle = input.guestName?.toLowerCase();

    const matched = reservations.filter((booking) => {
      if (input.status && booking.status !== input.status) return false;
      if (input.roomNumber && String(booking.roomNumber ?? "") !== input.roomNumber) {
        return false;
      }
      if (needle && !(booking.guestName ?? "").toLowerCase().includes(needle)) {
        return false;
      }
      return true;
    });

    matched.sort((a, b) => {
      const aDate = toPMSDate(a.checkIn as never)?.getTime() ?? 0;
      const bDate = toPMSDate(b.checkIn as never)?.getTime() ?? 0;
      return bDate - aDate;
    });

    const limit = input.limit ?? DEFAULT_LIMIT;
    return {
      matchCount: matched.length,
      returned: Math.min(matched.length, limit),
      // The model must know the list is cut off, or it will summarise a
      // truncated list as if it were complete.
      truncated: matched.length > limit,
      reservations: matched.slice(0, limit).map(detail),
      source: "reservations (front-desk flow)",
    };
  },
});

export const getUpcomingReservations = defineReadTool<{ days: number; limit: number }, unknown>({
  name: "get_upcoming_reservations",
  description:
    "Reservations arriving within the next N days (default 7), soonest first. Only active reservations (Confirmed or Checked In) are included.",
  inputSchema: UPCOMING_SCHEMA,
  allowedRoles: [...HOTEL_STAFF_ROLES],
  validateInput(raw) {
    const input = asObject(raw, ["days", "limit"]);
    return {
      days: boundedInt(input.days, "days", 1, 90, 7),
      limit: boundedInt(input.limit, "limit", 1, MAX_LIMIT, DEFAULT_LIMIT),
    };
  },
  async handler(_ctx, input, deps) {
    const from = new Date(deps.now);
    from.setHours(0, 0, 0, 0);
    const until = new Date(from);
    until.setDate(until.getDate() + input.days);

    const reservations = await deps.data.reservations();
    const upcoming = reservations
      .filter((booking) => {
        if (booking.status !== "Confirmed" && booking.status !== "Checked In") return false;
        const checkIn = toPMSDate(booking.checkIn as never);
        return !!checkIn && checkIn >= from && checkIn < until;
      })
      .sort((a, b) => {
        const aDate = toPMSDate(a.checkIn as never)?.getTime() ?? 0;
        const bDate = toPMSDate(b.checkIn as never)?.getTime() ?? 0;
        return aDate - bDate;
      });

    return {
      windowDays: input.days,
      from: from.toISOString(),
      untilExclusive: until.toISOString(),
      matchCount: upcoming.length,
      returned: Math.min(upcoming.length, input.limit),
      truncated: upcoming.length > input.limit,
      reservations: upcoming.slice(0, input.limit).map(detail),
      source: "reservations (front-desk flow)",
    };
  },
});
