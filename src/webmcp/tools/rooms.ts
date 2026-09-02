/**
 * Room operation tools.
 *
 * Routes through src/lib/roomService.ts, so an agent changing a room's
 * status writes the same audit entry the UI does.
 */
import { ROOM_STATUSES } from "../../lib/collections";
import { loadRooms, setRoomStatus } from "../../lib/roomService";
import { requireEnum, requireString, toolError, toolText } from "../toolInput";
import type { InnPilotWebMCPTool, WebMCPToolContext } from "../types";

export const setRoomStatusTool: InnPilotWebMCPTool = {
  name: "innpilot_set_room_status",
  description:
    "Change a room's housekeeping or maintenance status — for example marking a room as Cleaning after checkout, or Out of Service when it cannot be sold. Rooms set to Maintenance or Out of Service stop accepting new reservations.",
  inputSchema: {
    type: "object",
    properties: {
      roomNumber: { type: "string", description: "Room number to update, e.g. '101'." },
      status: {
        type: "string",
        enum: [...ROOM_STATUSES],
        description: "New room status.",
      },
    },
    required: ["roomNumber", "status"],
    additionalProperties: false,
  },
  async execute(input: Record<string, unknown>, context: WebMCPToolContext) {
    const roomNumber = requireString(input, "roomNumber");
    const status = requireEnum(input, "status", ROOM_STATUSES);

    const rooms = await loadRooms(context.hotelId);
    const room = rooms.find((r) => r.number.toLowerCase() === roomNumber.toLowerCase());
    if (!room) {
      return toolError(`Room "${roomNumber}" is not in this hotel's inventory.`);
    }

    const previous = room.status;
    const result = await setRoomStatus(context.hotelId, room, status);
    if (!result.ok) return toolError(result.error);
    if (!result.data.changed) {
      return toolText(`Room ${room.number} is already "${status}". No change made.`);
    }

    return toolText(`Room ${room.number} changed from "${previous}" to "${status}".`);
  },
};
