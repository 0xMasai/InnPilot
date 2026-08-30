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

export function bookingOverlaps(
  roomNumber: string,
  checkIn: Date,
  checkOut: Date,
  bookings: PMSBookingLike[]
): PMSBookingLike | undefined {
  return bookings.find((booking) => {
    if (String(booking.roomNumber ?? "") !== roomNumber) return false;
    if (!isActiveBooking(booking.status)) return false;
    const existingIn = toPMSDate(booking.checkIn);
    const existingOut = toPMSDate(booking.checkOut);
    if (!existingIn || !existingOut) return false;
    return checkIn < existingOut && existingIn < checkOut;
  });
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
