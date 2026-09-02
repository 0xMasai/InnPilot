/**
 * Reservation service.
 *
 * Extracted verbatim from src/pages/pms/Reservations.tsx so the rules that
 * protect room inventory live in exactly one place. Both the Reservations
 * UI and the WebMCP tools call these functions — neither re-implements
 * validation, the check-in/out time convention, or conflict detection.
 *
 * Conflict data is passed in rather than fetched here, so the UI can keep
 * using its live onSnapshot state (unchanged behaviour) while agents,
 * which have no snapshot, call loadReservationContext() first.
 */
import {
  addDoc,
  getDoc,
  getDocs,
  serverTimestamp,
  Timestamp,
  updateDoc,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { COLLECTIONS, type BookingStatus } from "./collections";
import { hotelCollection, hotelDoc, hotelDocRef } from "./hotelScope";
import { bookingDays, bookingOverlaps, type PMSBookingLike } from "./pms";
import {
  describeWriteFailure,
  errorCode,
  errorMessage,
  fail,
  ok,
  type ServiceResult,
} from "./serviceResult";

/** A reservation as stored in Firestore. `checkIn`/`checkOut` stay unknown — see toPMSDate(). */
export interface ReservationDoc extends PMSBookingLike {
  id: string;
  reservationId?: string;
  roomType?: string;
}

export interface RoomInventoryDoc {
  id: string;
  number: string;
  type?: string;
  price?: number;
  status: string;
}

/** Everything needed to validate a new reservation against current inventory. */
export interface ReservationContext {
  rooms: RoomInventoryDoc[];
  /** Current hotels/{id}/reservations. */
  reservations: ReservationDoc[];
  /** Legacy hotels/{id}/accomodation, still checked so migration can't double-book. */
  legacyBookings: ReservationDoc[];
}

function readDoc(snapshot: QueryDocumentSnapshot): Record<string, unknown> {
  return snapshot.data() as Record<string, unknown>;
}

function toReservation(snapshot: QueryDocumentSnapshot): ReservationDoc {
  const data = readDoc(snapshot);
  return {
    id: snapshot.id,
    reservationId: typeof data.reservationId === "string" ? data.reservationId : undefined,
    roomNumber: typeof data.roomNumber === "string" ? data.roomNumber : undefined,
    guestName: typeof data.guestName === "string" ? data.guestName : undefined,
    roomType: typeof data.roomType === "string" ? data.roomType : undefined,
    status: data.status as BookingStatus | undefined,
    checkIn: data.checkIn as ReservationDoc["checkIn"],
    checkOut: data.checkOut as ReservationDoc["checkOut"],
  };
}

function toRoom(snapshot: QueryDocumentSnapshot): RoomInventoryDoc {
  const data = readDoc(snapshot);
  return {
    id: snapshot.id,
    number: String(data.number ?? ""),
    type: typeof data.type === "string" ? data.type : undefined,
    price: typeof data.price === "number" ? data.price : undefined,
    status: String(data.status ?? "Available"),
  };
}

/** Reservation number format used by the Reservations page. */
export function makeReservationNumber(): string {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const suffix =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase()
      : Math.random().toString(36).slice(2, 8).toUpperCase();
  return `RSV-${stamp}-${suffix}`;
}

/** Fetches rooms and both booking collections for callers without a live snapshot. */
export async function loadReservationContext(hotelId: string): Promise<ReservationContext> {
  const [roomSnap, reservationSnap, legacySnap] = await Promise.all([
    getDocs(hotelCollection(hotelId, COLLECTIONS.ROOMS)),
    getDocs(hotelCollection(hotelId, COLLECTIONS.RESERVATIONS)),
    getDocs(hotelCollection(hotelId, COLLECTIONS.BOOKINGS)),
  ]);
  return {
    rooms: roomSnap.docs.map(toRoom),
    reservations: reservationSnap.docs.map(toReservation),
    legacyBookings: legacySnap.docs.map(toReservation),
  };
}

export interface CreateReservationInput {
  hotelId: string;
  /** uid of the acting user; written as `userId`, which security rules require on create. */
  uid: string;
  guestName: string;
  roomNumber: string;
  /** YYYY-MM-DD. Combined with the house check-in time (14:00). */
  checkIn: string;
  /** YYYY-MM-DD. Combined with the house check-out time (11:00). */
  checkOut: string;
  bookingSource: string;
  context: ReservationContext;
}

export interface CreatedReservation {
  id: string;
  reservationId: string;
  roomNumber: string;
  guestName: string;
  checkIn: Date;
  checkOut: Date;
  nights: number;
  ratePerNight: number;
  totalAmount: number;
}

/**
 * Validates and writes a reservation.
 *
 * Validation order and wording are preserved exactly from the original
 * component so the UI behaves identically after extraction.
 */
export async function createReservation(
  input: CreateReservationInput
): Promise<ServiceResult<CreatedReservation>> {
  const { hotelId, uid, roomNumber, checkIn, checkOut, bookingSource, context } = input;
  const guestName = input.guestName.trim();

  if (!guestName || !roomNumber || !checkIn || !checkOut) {
    return fail("Guest, room, check-in and check-out are required.");
  }

  // House convention: guests check in at 14:00 and out at 11:00.
  const start = new Date(`${checkIn}T14:00:00`);
  const end = new Date(`${checkOut}T11:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return fail("Check-out must be after check-in.");
  }

  const room = context.rooms.find((r) => r.number === roomNumber);
  if (!room) return fail("Select a valid room from this hotel's inventory.");
  if (room.status === "Maintenance" || room.status === "Out of Service") {
    return fail(`Room ${room.number} is unavailable for reservations.`);
  }

  // Check the new reservations collection and legacy accomodation records
  // together, so migration cannot introduce a double booking.
  const conflict = bookingOverlaps(roomNumber, start, end, [
    ...context.reservations,
    ...context.legacyBookings,
  ]);
  if (conflict) {
    return fail(`Room ${roomNumber} is already reserved for ${conflict.guestName || "another guest"}.`);
  }

  try {
    const hotelSnap = await getDoc(hotelDocRef(hotelId));
    if (!hotelSnap.exists()) throw new Error(`Hotel ${hotelId} does not exist.`);

    const reservationId = makeReservationNumber();
    const nights = bookingDays(start, end);
    const ratePerNight = Number(room.price || 0);
    const totalAmount = ratePerNight * nights;

    const ref = await addDoc(hotelCollection(hotelId, COLLECTIONS.RESERVATIONS), {
      reservationId,
      guestName,
      roomNumber,
      roomType: room.type || "Room",
      numberOfGuests: 1,
      checkIn: Timestamp.fromDate(start),
      checkOut: Timestamp.fromDate(end),
      status: "Confirmed" as BookingStatus,
      paymentStatus: "Pending" as const,
      pricePaid: 0,
      bookingSource,
      ratePerNight,
      totalAmount,
      hotelId,
      userId: uid,
      createdAt: serverTimestamp(),
    });

    return ok({
      id: ref.id,
      reservationId,
      roomNumber,
      guestName,
      checkIn: start,
      checkOut: end,
      nights,
      ratePerNight,
      totalAmount,
    });
  } catch (error) {
    console.error("Reservation creation failed", { hotelId, uid, roomNumber, error });
    return fail(describeWriteFailure(error, "Reservation could not be saved."));
  }
}

/** Moves a reservation to a new lifecycle status. */
export async function updateReservationStatus(
  hotelId: string,
  reservationDocId: string,
  status: BookingStatus
): Promise<ServiceResult<{ status: BookingStatus }>> {
  try {
    await updateDoc(hotelDoc(hotelId, COLLECTIONS.RESERVATIONS, reservationDocId), { status });
    return ok({ status });
  } catch (error) {
    console.error("Reservation update failed", { hotelId, reservationDocId, status, error });
    // Wording preserved from the original component handler.
    return fail(
      errorCode(error) === "permission-denied"
        ? "Firestore denied this reservation update."
        : errorMessage(error) || "Reservation could not be updated."
    );
  }
}
