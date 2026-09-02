/**
 * Room inventory service.
 *
 * Extracted from src/Accommodation.tsx so room writes — and the audit
 * entries that must accompany them — happen the same way whether the
 * caller is the UI or a WebMCP tool.
 */
import {
  addDoc,
  getDocs,
  serverTimestamp,
  updateDoc,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { COLLECTIONS, ROOM_STATUSES, type RoomStatus } from "./collections";
import { hotelCollection, hotelDoc } from "./hotelScope";
import { logAction } from "./audit";
import { errorMessage, fail, ok, type ServiceResult } from "./serviceResult";
import type { RoomInventoryDoc } from "./reservationService";

export function isRoomStatus(value: string): value is RoomStatus {
  return (ROOM_STATUSES as string[]).includes(value);
}

/** Reads the hotel's room inventory, sorted the way the UI sorts it. */
export async function loadRooms(hotelId: string): Promise<RoomInventoryDoc[]> {
  const snapshot = await getDocs(hotelCollection(hotelId, COLLECTIONS.ROOMS));
  const rooms = snapshot.docs.map((doc: QueryDocumentSnapshot) => {
    const data = doc.data() as Record<string, unknown>;
    return {
      id: doc.id,
      number: String(data.number ?? ""),
      type: typeof data.type === "string" ? data.type : undefined,
      price: typeof data.price === "number" ? data.price : undefined,
      status: String(data.status ?? "Available"),
    };
  });
  rooms.sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
  return rooms;
}

export interface AddRoomInput {
  hotelId: string;
  /** Written as `userId`; security rules require it to match the caller on create. */
  uid: string;
  number: string;
  type: string;
  price?: number;
  status: RoomStatus;
  /** Existing inventory, used to reject a duplicate room number. */
  existingRooms: RoomInventoryDoc[];
}

export async function addRoom(input: AddRoomInput): Promise<ServiceResult<{ id: string }>> {
  const number = input.number.trim();
  if (!number) return fail("Enter a room number.");
  if (input.existingRooms.some((room) => room.number === number)) {
    return fail(`Room ${number} already exists.`);
  }

  try {
    const ref = await addDoc(hotelCollection(input.hotelId, COLLECTIONS.ROOMS), {
      number,
      type: input.type,
      price: input.price || 0,
      status: input.status,
      createdAt: serverTimestamp(),
      userId: input.uid,
    });
    logAction(input.hotelId, "Room added", "room", ref.id, `${number} (${input.type})`);
    return ok({ id: ref.id });
  } catch (error) {
    console.error("Failed to add room:", error);
    return fail("Failed to add room. Please try again.");
  }
}

/**
 * Changes a room's status and records it in the audit trail.
 * A no-op (reported as success) when the room already has that status,
 * matching the guard the UI has always applied.
 */
export async function setRoomStatus(
  hotelId: string,
  room: RoomInventoryDoc,
  status: RoomStatus
): Promise<ServiceResult<{ changed: boolean }>> {
  if (room.status === status) return ok({ changed: false });

  try {
    await updateDoc(hotelDoc(hotelId, COLLECTIONS.ROOMS, room.id), { status });
    logAction(
      hotelId,
      "Room status changed",
      "room",
      room.id,
      `${room.number}: ${room.status} → ${status}`
    );
    return ok({ changed: true });
  } catch (error) {
    console.error("Failed to update room status:", error);
    return fail(errorMessage(error) || "Room status could not be updated.");
  }
}
