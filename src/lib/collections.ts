/**
 * Single source of truth for Firestore collection names.
 *
 * NOTE: "accomodation" (misspelled) is intentional — it matches every
 * existing booking document. Renaming requires a data migration; when that
 * happens, change it here only.
 */
export const COLLECTIONS = {
  USERS: "users",
  ROOMS: "rooms",
  BOOKINGS: "accomodation",
  RESTAURANT: "restaurant",
  /** Conference *bookings* (legacy name kept — matches existing documents). */
  CONFERENCE: "conferenceRooms",
  /** Conference room inventory (the physical spaces). */
  CONFERENCE_SPACES: "conferenceSpaces",
  EXPENSES: "expenses",
  AUDIT: "auditLog",
} as const;

/** Lifecycle of an accommodation booking. */
export type BookingStatus =
  | "Confirmed"
  | "Checked In"
  | "Checked Out"
  | "Cancelled"
  | "No Show";

/** Housekeeping/operational status of a physical room. */
export type RoomStatus =
  | "Available"
  | "Occupied"
  | "Cleaning"
  | "Maintenance"
  | "Out of Service";

export const BOOKING_STATUSES: BookingStatus[] = [
  "Confirmed",
  "Checked In",
  "Checked Out",
  "Cancelled",
  "No Show",
];

export const ROOM_STATUSES: RoomStatus[] = [
  "Available",
  "Occupied",
  "Cleaning",
  "Maintenance",
  "Out of Service",
];

/** Statuses that make a booking block its room for the booked dates. */
export const ACTIVE_BOOKING_STATUSES: BookingStatus[] = [
  "Confirmed",
  "Checked In",
];
