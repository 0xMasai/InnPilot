/**
 * Role sets for tools, mirroring `firestore.rules`.
 *
 * `hotelStaff(hotelId)` in the rules grants read access to rooms,
 * accomodation, reservations, restaurant, conferenceRooms and expenses to
 * both hotel_admin and staff — so every Phase 4 read tool allows exactly
 * that pair. Widening this would let the assistant answer questions the
 * same user could not answer by clicking through the app; narrowing it
 * would make the assistant arbitrarily less useful than the UI beside it.
 *
 * `super_admin` is absent on purpose: it has no hotelId, and every V1 tool
 * is hotel-scoped (the Permission Guard rejects it via requireHotelContext).
 * Platform-wide tooling is a separate decision, not an accident of this list.
 *
 * The two rules-restricted collections — auditLog and nightAudits, both
 * hotelAdmin-only — have no tools in Phase 4.
 */
import type { Role } from "../types";

export const STAFF_AND_ADMIN: Role[] = ["hotel_admin", "staff"];
