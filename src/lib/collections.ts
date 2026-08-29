/** Single source of truth for Firestore collection names. */
export const COLLECTIONS = {
  USERS: "users",
  ROOMS: "rooms",
  BOOKINGS: "accomodation",
  RESERVATIONS: "reservations",
  FOLIO_ITEMS: "folioItems",
  PAYMENTS: "payments",
  RESTAURANT: "restaurant",
  CONFERENCE: "conferenceRooms",
  CONFERENCE_SPACES: "conferenceSpaces",
  EXPENSES: "expenses",
  AUDIT: "auditLog",
  HOUSEKEEPING_TASKS: "housekeepingTasks",
  MAINTENANCE: "maintenanceRequests",
  NIGHT_AUDITS: "nightAudits",
} as const;

export type BookingStatus = "Confirmed" | "Checked In" | "Checked Out" | "Cancelled" | "No Show";
export type RoomStatus = "Available" | "Occupied" | "Cleaning" | "Maintenance" | "Out of Service";

export const BOOKING_STATUSES: BookingStatus[] = ["Confirmed", "Checked In", "Checked Out", "Cancelled", "No Show"];
export const ROOM_STATUSES: RoomStatus[] = ["Available", "Occupied", "Cleaning", "Maintenance", "Out of Service"];
export const ACTIVE_BOOKING_STATUSES: BookingStatus[] = ["Confirmed", "Checked In"];
