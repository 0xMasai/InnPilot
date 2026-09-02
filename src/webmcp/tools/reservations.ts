/**
 * Reservation write tools.
 *
 * These call src/lib/reservationService.ts — the same functions the
 * Reservations page uses — so validation, the check-in/out convention and
 * double-booking protection are shared, not re-implemented.
 *
 * Agent-initiated writes additionally call logAction(). The UI does not
 * audit these two operations today, and extraction deliberately left that
 * behaviour untouched; auditing is added here, at the tool layer, because
 * a change made by an agent should always be attributable.
 */
import { BOOKING_STATUSES, type BookingStatus } from "../../lib/collections";
import { logAction } from "../../lib/audit";
import { money, toPMSDate } from "../../lib/pms";
import {
  createReservation,
  loadReservationContext,
  updateReservationStatus,
} from "../../lib/reservationService";
import { optionalString, requireDate, requireEnum, requireString, toolError, toolText } from "../toolInput";
import type { InnPilotWebMCPTool, WebMCPToolContext } from "../types";

const BOOKING_SOURCES = [
  "Direct",
  "Walk-in",
  "Phone",
  "Website",
  "Booking.com",
  "Expedia",
  "Travel Agent",
  "Other",
] as const;

export const createReservationTool: InnPilotWebMCPTool = {
  name: "innpilot_create_reservation",
  description:
    "Create a confirmed reservation for a guest. Rejects the booking if the room does not exist, is under maintenance, or is already reserved for any part of the stay. Check availability first with innpilot_check_room_availability.",
  inputSchema: {
    type: "object",
    properties: {
      guestName: { type: "string", description: "Full name of the guest." },
      roomNumber: { type: "string", description: "Room number to book, e.g. '101'." },
      checkIn: { type: "string", description: "Arrival date, YYYY-MM-DD. Check-in time is 14:00." },
      checkOut: { type: "string", description: "Departure date, YYYY-MM-DD. Check-out time is 11:00." },
      bookingSource: {
        type: "string",
        enum: [...BOOKING_SOURCES],
        description: "How the booking arrived. Defaults to 'Direct'.",
      },
    },
    required: ["guestName", "roomNumber", "checkIn", "checkOut"],
    additionalProperties: false,
  },
  async execute(input: Record<string, unknown>, context: WebMCPToolContext) {
    const guestName = requireString(input, "guestName");
    const roomNumber = requireString(input, "roomNumber");
    const checkIn = requireDate(input, "checkIn");
    const checkOut = requireDate(input, "checkOut");
    const bookingSource = optionalString(input, "bookingSource") ?? "Direct";

    const result = await createReservation({
      hotelId: context.hotelId,
      uid: context.auth.uid,
      guestName,
      roomNumber,
      checkIn,
      checkOut,
      bookingSource,
      context: await loadReservationContext(context.hotelId),
    });

    if (!result.ok) return toolError(result.error);

    const r = result.data;
    logAction(
      context.hotelId,
      "Reservation created (agent)",
      "booking",
      r.id,
      `${r.reservationId} · ${r.guestName} · room ${r.roomNumber} · ${checkIn} → ${checkOut}`
    );

    return toolText(
      [
        `Reservation ${r.reservationId} confirmed.`,
        `- Guest: ${r.guestName}`,
        `- Room ${r.roomNumber}, ${r.nights} night(s): ${checkIn} 14:00 → ${checkOut} 11:00`,
        `- Rate: ${money(r.ratePerNight)} per night, total ${money(r.totalAmount)}`,
        "Payment status is Pending; no payment has been taken.",
      ].join("\n")
    );
  },
};

export const updateReservationStatusTool: InnPilotWebMCPTool = {
  name: "innpilot_update_reservation_status",
  description:
    "Move a reservation through its lifecycle — check a guest in or out, cancel a booking, or mark a no-show. Identify the reservation by its reference (e.g. 'RSV-20260901-A1B2C3') or guest name.",
  inputSchema: {
    type: "object",
    properties: {
      reservation: {
        type: "string",
        description: "Reservation reference, or the guest's name if the reference is unknown.",
      },
      status: {
        type: "string",
        enum: [...BOOKING_STATUSES],
        description: "New status for the reservation.",
      },
    },
    required: ["reservation", "status"],
    additionalProperties: false,
  },
  async execute(input: Record<string, unknown>, context: WebMCPToolContext) {
    const needle = requireString(input, "reservation").toLowerCase();
    const status = requireEnum(input, "status", BOOKING_STATUSES);

    const { reservations } = await loadReservationContext(context.hotelId);
    const matches = reservations.filter(
      (r) =>
        (r.reservationId ?? "").toLowerCase() === needle ||
        r.id.toLowerCase() === needle ||
        (r.guestName ?? "").toLowerCase() === needle
    );

    if (matches.length === 0) {
      return toolError(
        `No reservation found matching "${needle}". Use innpilot_list_reservations to see current reservations.`
      );
    }
    if (matches.length > 1) {
      const options = matches
        .map(
          (r) =>
            `- ${r.reservationId ?? r.id} · ${r.guestName ?? "Guest"} · room ${r.roomNumber ?? "—"} · ${r.status}`
        )
        .join("\n");
      return toolError(
        `"${needle}" matches ${matches.length} reservations. Re-run with the exact reference:\n${options}`
      );
    }

    const target = matches[0];
    if (target.status === status) {
      return toolText(`Reservation ${target.reservationId ?? target.id} is already "${status}". No change made.`);
    }

    const result = await updateReservationStatus(context.hotelId, target.id, status as BookingStatus);
    if (!result.ok) return toolError(result.error);

    logAction(
      context.hotelId,
      `Reservation ${status.toLowerCase()} (agent)`,
      "booking",
      target.id,
      `${target.reservationId ?? target.id} · ${target.guestName ?? "Guest"} · ${target.status} → ${status}`
    );

    return toolText(
      `Reservation ${target.reservationId ?? target.id} (${target.guestName ?? "Guest"}, room ${target.roomNumber ?? "—"}) is now "${status}".`
    );
  },
};

export const listReservationsTool: InnPilotWebMCPTool = {
  name: "innpilot_list_reservations",
  description:
    "List this hotel's current reservations with reference, guest, room, dates and status. Use to find a reservation before changing its status.",
  inputSchema: {
    type: "object",
    properties: {
      status: {
        type: "string",
        enum: [...BOOKING_STATUSES],
        description: "Optional status filter. Omit to list all reservations.",
      },
    },
    additionalProperties: false,
  },
  async execute(input: Record<string, unknown>, context: WebMCPToolContext) {
    const status = optionalString(input, "status");
    const { reservations } = await loadReservationContext(context.hotelId);
    const filtered = status
      ? reservations.filter((r) => (r.status ?? "").toLowerCase() === status.toLowerCase())
      : reservations;

    if (filtered.length === 0) {
      return toolText(
        status ? `No reservations with status "${status}".` : "This hotel has no reservations yet."
      );
    }

    const lines = filtered.slice(0, 50).map((r) => {
      const from = toPMSDate(r.checkIn)?.toLocaleDateString() ?? "—";
      const to = toPMSDate(r.checkOut)?.toLocaleDateString() ?? "—";
      return `- ${r.reservationId ?? r.id} · ${r.guestName ?? "Guest"} · room ${r.roomNumber ?? "—"} · ${from} → ${to} · ${r.status ?? "—"}`;
    });
    const more = filtered.length > 50 ? `\n(showing 50 of ${filtered.length})` : "";
    return toolText(`${filtered.length} reservation(s):\n${lines.join("\n")}${more}`);
  },
};
