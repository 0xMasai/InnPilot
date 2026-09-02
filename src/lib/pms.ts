/** Core PMS domain helpers. Keep business rules pure so UI and future server jobs can share them. */

import type { BookingStatus, RoomStatus } from "./collections";

export type OperationalRoomStatus = RoomStatus | "Ready";

export interface DateLikeValue {
  toDate?: () => Date;
}

export interface PMSBookingLike {
  roomNumber?: string;
  guestName?: string;
  checkIn?: Date | DateLikeValue | string | number;
  checkOut?: Date | DateLikeValue | string | number;
  status?: BookingStatus;
  /**
   * Legacy accomodation records predate `status` and carry only this flag.
   * Kept here so one overlap rule covers both collections — see
   * effectiveBookingStatus().
   */
  isOccupied?: boolean;
}

export interface PMSRoomLike {
  number: string;
  status: RoomStatus;
}

export function toPMSDate(value: PMSBookingLike["checkIn"]): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "object") {
    if (typeof value.toDate !== "function") return null;
    const date = value.toDate();
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function startOfDay(date = new Date()): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

export function endOfDay(date = new Date()): Date {
  const result = new Date(date);
  result.setHours(23, 59, 59, 999);
  return result;
}

export function isSameDay(a: Date | null, b: Date): boolean {
  if (!a) return false;
  return startOfDay(a).getTime() === startOfDay(b).getTime();
}

export function isActiveBooking(status?: BookingStatus): boolean {
  return status === "Confirmed" || status === "Checked In";
}

/**
 * The status a record behaves as. Identical to metrics.bookingStatusOf(),
 * duplicated in domain terms rather than imported so this module stays
 * dependency-free: a legacy accomodation document written before the
 * `status` field existed is still a real stay, and must block inventory
 * exactly as the Accommodation page has always treated it.
 */
export function effectiveBookingStatus(booking: PMSBookingLike): BookingStatus {
  return booking.status ?? (booking.isOccupied ? "Checked In" : "Confirmed");
}

export function bookingOverlaps(
  roomNumber: string,
  checkIn: Date,
  checkOut: Date,
  bookings: PMSBookingLike[]
): PMSBookingLike | undefined {
  return bookings.find((booking) => {
    if (String(booking.roomNumber ?? "") !== roomNumber) return false;
    if (!isActiveBooking(effectiveBookingStatus(booking))) return false;
    const existingIn = toPMSDate(booking.checkIn);
    const existingOut = toPMSDate(booking.checkOut);
    if (!existingIn || !existingOut) return false;
    return checkIn < existingOut && existingIn < checkOut;
  });
}

/**
 * Whether a room can take a stay over [checkIn, checkOut).
 *
 * `bookings` must carry every collection that can hold a stay — today
 * hotels/{id}/reservations AND the legacy hotels/{id}/accomodation — or a
 * booking made through one screen will look free on another.
 */
export function isRoomAvailableForStay(
  room: { number: string; status: string },
  checkIn: Date,
  checkOut: Date,
  bookings: PMSBookingLike[]
): boolean {
  if (bookableRooms([room]).length === 0) return false;
  return !bookingOverlaps(room.number, checkIn, checkOut, bookings);
}

/** The rooms that can take a stay over the given dates. */
export function availableRoomsForStay<T extends { number: string; status: string }>(
  rooms: T[],
  checkIn: Date,
  checkOut: Date,
  bookings: PMSBookingLike[]
): T[] {
  return rooms.filter((room) => isRoomAvailableForStay(room, checkIn, checkOut, bookings));
}

/**
 * What a room's bookings say about it right now — deliberately separate
 * from the room document's own status.
 *
 * A room is a physical thing with a housekeeping status (Available,
 * Cleaning, Maintenance…). Reservations are commercial records laid over
 * it. Conflating the two is what makes a future booking look like an
 * occupied room, so this returns them as distinct facts and writes
 * nothing back to the room.
 */
export interface RoomBookingState {
  /** A guest is checked in and has not checked out. */
  inHouse?: PMSBookingLike;
  /** Confirmed booking whose stay covers now — arriving today, not yet in. */
  arrivingToday?: PMSBookingLike;
  /** The soonest confirmed booking that starts later. */
  nextReservation?: PMSBookingLike;
}

export function roomBookingState(
  roomNumber: string,
  bookings: PMSBookingLike[],
  now = new Date()
): RoomBookingState {
  const forRoom = bookings.filter(
    (booking) =>
      String(booking.roomNumber ?? "") === roomNumber &&
      isActiveBooking(effectiveBookingStatus(booking))
  );

  const startOf = (booking: PMSBookingLike) => toPMSDate(booking.checkIn);
  const isConfirmed = (booking: PMSBookingLike) => effectiveBookingStatus(booking) === "Confirmed";

  const inHouse = forRoom.find((booking) => {
    if (effectiveBookingStatus(booking) !== "Checked In") return false;
    const end = toPMSDate(booking.checkOut);
    // A stay past its checkout date that nobody has closed is still in-house.
    return !end || now < end || isSameDay(end, now);
  });

  const arrivingToday = forRoom.find(
    (booking) => isConfirmed(booking) && isSameDay(startOf(booking), now)
  );

  const nextReservation = forRoom
    .filter((booking) => {
      const start = startOf(booking);
      return !!start && start > now && !isSameDay(start, now);
    })
    .sort((a, b) => (startOf(a)?.getTime() ?? 0) - (startOf(b)?.getTime() ?? 0))[0];

  return { inHouse, arrivingToday, nextReservation };
}

/**
 * Rooms that can hold a reservation: maintenance and out-of-service rooms
 * are never bookable. Shared by the Reservations page and the WebMCP
 * availability tool so both apply the identical rule.
 */
export function bookableRooms<T extends { status: string }>(rooms: T[]): T[] {
  return rooms.filter((room) => room.status !== "Maintenance" && room.status !== "Out of Service");
}

export function operationalStatus(room: PMSRoomLike): OperationalRoomStatus {
  return room.status === "Available" ? "Ready" : room.status;
}

export function occupancyRate(occupied: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((occupied / total) * 100);
}

export function money(value: unknown, currency = "UGX"): string {
  const amount = Number(value ?? 0);
  return `${currency} ${Number.isFinite(amount) ? amount.toLocaleString() : "0"}`;
}

export function bookingDays(checkIn: Date | null, checkOut: Date | null): number {
  if (!checkIn || !checkOut || checkOut <= checkIn) return 0;
  return Math.max(1, Math.ceil((checkOut.getTime() - checkIn.getTime()) / 86_400_000));
}
