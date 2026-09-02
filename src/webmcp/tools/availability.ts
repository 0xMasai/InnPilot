/**
 * Room inventory and availability tools.
 *
 * Availability reuses bookingOverlaps() — the exact rule that guards
 * reservation creation — so a room this tool reports as free is a room
 * innpilot_create_reservation will accept.
 */
import { loadReservationContext } from "../../lib/reservationService";
import { bookableRooms, bookingOverlaps } from "../../lib/pms";
import { loadRooms } from "../../lib/roomService";
import { money } from "../../lib/pms";
import { requireDate, optionalString, toolError, toolText } from "../toolInput";
import { ToolInputError, type InnPilotWebMCPTool, type WebMCPToolContext } from "../types";

export const listRoomsTool: InnPilotWebMCPTool = {
  name: "innpilot_list_rooms",
  description:
    "List this hotel's rooms with their number, type, nightly rate and current housekeeping status (Available, Occupied, Cleaning, Maintenance, Out of Service). Use to see inventory, not to check whether a room is free for specific dates.",
  inputSchema: {
    type: "object",
    properties: {
      status: {
        type: "string",
        description: "Optional filter, e.g. 'Occupied' or 'Cleaning'. Omit to list every room.",
      },
    },
    additionalProperties: false,
  },
  async execute(input: Record<string, unknown>, context: WebMCPToolContext) {
    const statusFilter = optionalString(input, "status");
    const rooms = await loadRooms(context.hotelId);
    const filtered = statusFilter
      ? rooms.filter((room) => room.status.toLowerCase() === statusFilter.toLowerCase())
      : rooms;

    if (filtered.length === 0) {
      return toolText(
        statusFilter
          ? `No rooms currently have status "${statusFilter}".`
          : "This hotel has no rooms registered yet."
      );
    }

    const lines = filtered.map(
      (room) => `- Room ${room.number} · ${room.type || "Room"} · ${money(room.price)} · ${room.status}`
    );
    return toolText(`${filtered.length} room(s):\n${lines.join("\n")}`);
  },
};

export const checkAvailabilityTool: InnPilotWebMCPTool = {
  name: "innpilot_check_room_availability",
  description:
    "Find which rooms are free for a given stay. Checks both current and legacy bookings, and excludes rooms under maintenance or out of service. Call this before creating a reservation.",
  inputSchema: {
    type: "object",
    properties: {
      checkIn: { type: "string", description: "Arrival date, YYYY-MM-DD." },
      checkOut: { type: "string", description: "Departure date, YYYY-MM-DD. Must be after checkIn." },
      roomType: { type: "string", description: "Optional room type filter, e.g. 'Double'." },
    },
    required: ["checkIn", "checkOut"],
    additionalProperties: false,
  },
  async execute(input: Record<string, unknown>, context: WebMCPToolContext) {
    const checkIn = requireDate(input, "checkIn");
    const checkOut = requireDate(input, "checkOut");
    const roomType = optionalString(input, "roomType");

    // Same house convention the reservation service applies.
    const start = new Date(`${checkIn}T14:00:00`);
    const end = new Date(`${checkOut}T11:00:00`);
    if (end <= start) throw new ToolInputError("checkOut must be after checkIn.");

    const ctx = await loadReservationContext(context.hotelId);
    const occupying = [...ctx.reservations, ...ctx.legacyBookings];

    const candidates = bookableRooms(ctx.rooms).filter(
      (room) => !roomType || (room.type || "").toLowerCase() === roomType.toLowerCase()
    );
    const free = candidates.filter(
      (room) => !bookingOverlaps(room.number, start, end, occupying)
    );

    if (free.length === 0) {
      return toolError(
        `No rooms are available from ${checkIn} to ${checkOut}${roomType ? ` for type "${roomType}"` : ""}.`
      );
    }

    const lines = free.map(
      (room) => `- Room ${room.number} · ${room.type || "Room"} · ${money(room.price)} per night`
    );
    return toolText(
      `${free.length} room(s) available from ${checkIn} to ${checkOut}:\n${lines.join("\n")}`
    );
  },
};
