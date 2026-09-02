/**
 * Room write tools.
 *
 * `update_room_status` is the brief's own worked example ("Mark Room 204 as
 * dirty"). It changes exactly one field on one room document — the same
 * field, on the same collection, that `setRoomStatus()` in
 * `src/lib/roomService.ts` writes when a person clicks the Room Board. The
 * assistant is doing what the user could do by hand, not more.
 *
 * Nothing here decides whether the change is allowed to happen: the
 * Permission Guard checked the role, and the Confirmation Manager holds the
 * user's approval. By the time `handler` runs, both have already passed.
 */
import type { ToolDefinition, ToolContext } from "../../types";
import { ToolValidationError } from "../../types";
import { STAFF_AND_ADMIN } from "../roles";
import { listDocsUncached, readDocUncached, updateDocFields } from "../dataAccess";
import { requiredEnum, requiredString, strictObject } from "../validation";
import { COLLECTIONS, ROOM_STATUSES, type RoomStatus } from "../../../../src/lib/collections";

interface RoomDoc {
  number?: string;
  type?: string;
  status?: RoomStatus;
}

export interface UpdateRoomStatusInput {
  roomNumber: string;
  status: RoomStatus;
}

/**
 * Find the one room a reference names.
 *
 * Refuses rather than guesses. Two rooms numbered "204" is a data problem
 * the assistant must not paper over by picking one — the wrong guess here
 * changes the wrong room, and nobody would know which.
 */
async function resolveRoom(
  hotelId: string,
  roomNumber: string
): Promise<RoomDoc & { id: string }> {
  const rooms = await listDocsUncached<RoomDoc>(hotelId, COLLECTIONS.ROOMS);
  const wanted = roomNumber.trim().toLowerCase();
  const matches = rooms.filter((room) => String(room.number ?? "").trim().toLowerCase() === wanted);

  if (matches.length === 0) {
    const known = rooms
      .map((room) => room.number)
      .filter((n): n is string => Boolean(n))
      .sort();
    throw new ToolValidationError(
      known.length
        ? `No room numbered '${roomNumber}'. This hotel has: ${known.join(", ")}.`
        : `No room numbered '${roomNumber}'. This hotel has no rooms registered.`
    );
  }

  if (matches.length > 1) {
    throw new ToolValidationError(
      `More than one room is numbered '${roomNumber}'. Ask the user which one they mean; do not choose.`
    );
  }

  return matches[0];
}

export const updateRoomStatus: ToolDefinition<UpdateRoomStatusInput, unknown> = {
  name: "update_room_status",
  description:
    "Change one room's housekeeping status. Requires the user to confirm " +
    "before anything changes. " +
    "USE FOR: 'mark room 204 as dirty', 'room 12 is ready', 'put 305 under " +
    "maintenance'. " +
    "NOT FOR: reading what a status currently is (get_room_status), or " +
    "checking a guest in or out — a room's status and a booking's status " +
    "are different records (update_reservation_status).",
  allowedRoles: STAFF_AND_ADMIN,
  isWrite: true,
  inputSchema: {
    type: "object",
    properties: {
      roomNumber: {
        type: "string",
        description: "The room number as the hotel writes it, e.g. '204'.",
      },
      status: {
        type: "string",
        enum: [...ROOM_STATUSES],
        description:
          "The status to set. 'Cleaning' is what a hotel means by a dirty room.",
      },
    },
    required: ["roomNumber", "status"],
    additionalProperties: false,
  },
  validateInput: (raw) => {
    const input = strictObject(raw, ["roomNumber", "status"]);
    return {
      roomNumber: requiredString(input, "roomNumber", 20),
      status: requiredEnum(input, "status", ROOM_STATUSES),
    };
  },

  /**
   * Read the room and state the change as a person would check it. The
   * current value is included because approving "set 204 to Cleaning" is a
   * different decision when 204 is Occupied than when it is Available.
   */
  summarize: async (ctx: ToolContext, input: UpdateRoomStatusInput) => {
    const hotelId = ctx.hotelId as string;
    const room = await resolveRoom(hotelId, input.roomNumber);

    if (room.status === input.status) {
      throw new ToolValidationError(
        `Room ${room.number} is already '${input.status}'. Nothing to change.`
      );
    }

    return `Change room ${room.number}${room.type ? ` (${room.type})` : ""} from '${
      room.status ?? "no status"
    }' to '${input.status}'.`;
  },

  handler: async (ctx, input) => {
    const hotelId = ctx.hotelId as string;

    // Resolved again rather than carried over from `summarize`: minutes may
    // have passed, and the room is whatever it is now. If someone else
    // already made this change, the no-op check below catches it.
    const room = await resolveRoom(hotelId, input.roomNumber);
    const previousStatus = room.status ?? null;

    if (previousStatus === input.status) {
      return {
        changed: false,
        roomNumber: room.number,
        status: input.status,
        note: "Already set to that status; nothing was written.",
      };
    }

    await updateDocFields(hotelId, COLLECTIONS.ROOMS, room.id, { status: input.status });

    // Read back rather than assume. The reply a user sees is built from
    // this, and "it worked" should mean the stored document says so.
    const stored = await readDocUncached<RoomDoc>(hotelId, COLLECTIONS.ROOMS, room.id);

    return {
      changed: true,
      roomNumber: room.number,
      previousStatus,
      status: stored?.status ?? input.status,
      confirmedByReadBack: stored?.status === input.status,
    };
  },
};
