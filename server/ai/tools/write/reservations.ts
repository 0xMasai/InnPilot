/**
 * Reservation write tools.
 *
 * `update_reservation_status` moves one booking along its lifecycle —
 * checking a guest in, checking them out, cancelling, marking a no-show.
 * It writes the same single field on the same collection as
 * `updateReservationStatus()` in `src/lib/reservationService.ts`, which is
 * what the Reservations page calls, and as the WebMCP tool of the same
 * purpose in `src/webmcp/tools/reservations.ts`.
 *
 * Deliberately limited to `reservations`. The legacy `accomodation`
 * collection holds stays too and the read tools combine both, but it
 * predates the status field entirely (records there carry `isOccupied` —
 * see `effectiveBookingStatus()` in src/lib/pms.ts). Writing a status onto
 * a record whose shape does not have one is how a migration gets a third
 * state nobody planned; those stay read-only.
 */
import type { ToolDefinition, ToolContext } from "../../types";
import { ToolValidationError } from "../../types";
import { STAFF_AND_ADMIN } from "../roles";
import { listDocsUncached, readDocUncached, updateDocFields } from "../dataAccess";
import { requiredEnum, requiredString, strictObject } from "../validation";
import {
  BOOKING_STATUSES,
  COLLECTIONS,
  type BookingStatus,
} from "../../../../src/lib/collections";

interface ReservationDoc {
  reservationId?: string;
  guestName?: string;
  roomNumber?: string;
  status?: BookingStatus;
}

export interface UpdateReservationStatusInput {
  reservation: string;
  status: BookingStatus;
}

/** How a reservation reads in an error message or a summary. */
function describe(doc: ReservationDoc): string {
  const parts = [doc.guestName || "Unnamed guest"];
  if (doc.roomNumber) parts.push(`room ${doc.roomNumber}`);
  if (doc.reservationId) parts.push(doc.reservationId);
  return parts.join(", ");
}

/**
 * Find the one reservation a reference names.
 *
 * A reference may be a reservation number or a guest name, because those
 * are what a person says out loud. Matching is exact on the reservation
 * number first — an unambiguous identifier should never lose to a fuzzy
 * name match — then falls back to guest name.
 *
 * Ambiguity is refused and the candidates listed, the same rule the WebMCP
 * tools apply: two guests called "John" is precisely when picking one is
 * most likely to check in the wrong person.
 */
async function resolveReservation(
  hotelId: string,
  reference: string
): Promise<ReservationDoc & { id: string }> {
  const all = await listDocsUncached<ReservationDoc>(hotelId, COLLECTIONS.RESERVATIONS);
  const wanted = reference.trim().toLowerCase();

  const byNumber = all.filter(
    (doc) => String(doc.reservationId ?? "").trim().toLowerCase() === wanted
  );
  if (byNumber.length === 1) return byNumber[0];

  const byName = all.filter((doc) =>
    String(doc.guestName ?? "").trim().toLowerCase().includes(wanted)
  );
  const matches = byNumber.length > 1 ? byNumber : byName;

  if (matches.length === 0) {
    throw new ToolValidationError(
      `No reservation matches '${reference}'. Try the reservation number, or the guest's name as recorded.`
    );
  }

  if (matches.length > 1) {
    const candidates = matches.slice(0, 5).map(describe).join("; ");
    throw new ToolValidationError(
      `'${reference}' matches ${matches.length} reservations: ${candidates}. ` +
        "Ask the user which one they mean; do not choose."
    );
  }

  return matches[0];
}

export const updateReservationStatus: ToolDefinition<UpdateReservationStatusInput, unknown> = {
  name: "update_reservation_status",
  description:
    "Move one reservation along its lifecycle: check a guest in or out, " +
    "cancel a booking, or mark a no-show. Requires the user to confirm " +
    "before anything changes. " +
    "USE FOR: 'check in Sarah Mensah', 'check out room 12', 'cancel " +
    "reservation R-1043', 'mark that booking as a no-show'. " +
    "NOT FOR: reading who is arriving (get_check_ins) or listing bookings " +
    "(get_reservations), and NOT for a room's housekeeping status, which is " +
    "a separate record (update_room_status). Cannot create or delete a " +
    "reservation, and cannot change dates, rates or guest details.",
  allowedRoles: STAFF_AND_ADMIN,
  isWrite: true,
  auditEntity: "booking",
  inputSchema: {
    type: "object",
    properties: {
      reservation: {
        type: "string",
        description:
          "Reservation number, or the guest's name as recorded. Must identify exactly one booking.",
      },
      status: {
        type: "string",
        enum: [...BOOKING_STATUSES],
        description:
          "'Checked In' for an arrival, 'Checked Out' for a departure, " +
          "'Cancelled' or 'No Show' to close a booking that will not happen.",
      },
    },
    required: ["reservation", "status"],
    additionalProperties: false,
  },
  validateInput: (raw) => {
    const input = strictObject(raw, ["reservation", "status"]);
    return {
      reservation: requiredString(input, "reservation", 120),
      status: requiredEnum(input, "status", BOOKING_STATUSES),
    };
  },

  summarize: async (ctx: ToolContext, input: UpdateReservationStatusInput) => {
    const hotelId = ctx.hotelId as string;
    const reservation = await resolveReservation(hotelId, input.reservation);

    if (reservation.status === input.status) {
      throw new ToolValidationError(
        `That reservation (${describe(reservation)}) is already '${input.status}'. Nothing to change.`
      );
    }

    return `Change the reservation for ${describe(reservation)} from '${
      reservation.status ?? "no status"
    }' to '${input.status}'.`;
  },

  handler: async (ctx, input) => {
    const hotelId = ctx.hotelId as string;

    // Re-resolved for the same reason as update_room_status: the confirmed
    // write runs in a later request than the proposal that described it.
    const reservation = await resolveReservation(hotelId, input.reservation);
    const previousStatus = reservation.status ?? null;

    if (previousStatus === input.status) {
      return {
        changed: false,
        reservation: describe(reservation),
        status: input.status,
        note: "Already at that status; nothing was written.",
      };
    }

    await updateDocFields(hotelId, COLLECTIONS.RESERVATIONS, reservation.id, {
      status: input.status,
    });

    const stored = await readDocUncached<ReservationDoc>(
      hotelId,
      COLLECTIONS.RESERVATIONS,
      reservation.id
    );

    return {
      id: reservation.id,
      changed: true,
      reservation: describe(reservation),
      previousStatus,
      status: stored?.status ?? input.status,
      confirmedByReadBack: stored?.status === input.status,
    };
  },
};
