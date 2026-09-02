/**
 * Loads a MetricsInput for callers that have no live onSnapshot state.
 *
 * The dashboards subscribe to these six collections and combine them in
 * memory; WebMCP tools need the same shape as a one-shot read. The
 * combination rule is copied from Overview.tsx / Reports.tsx: legacy
 * `accomodation` and newer `reservations` documents are BOTH booking
 * records, so occupancy and revenue must be computed over the two
 * together — reading only one silently under-reports any hotel that has
 * moved between flows.
 */
import { getDocs } from "firebase/firestore";
import { COLLECTIONS } from "./collections";
import { hotelCollection } from "./hotelScope";
import type { MetricsInput } from "./metrics";

export async function loadMetricsInput(hotelId: string): Promise<MetricsInput> {
  const [legacy, reservations, orders, events, expenses, rooms] = await Promise.all([
    getDocs(hotelCollection(hotelId, COLLECTIONS.BOOKINGS)),
    getDocs(hotelCollection(hotelId, COLLECTIONS.RESERVATIONS)),
    getDocs(hotelCollection(hotelId, COLLECTIONS.RESTAURANT)),
    getDocs(hotelCollection(hotelId, COLLECTIONS.CONFERENCE)),
    getDocs(hotelCollection(hotelId, COLLECTIONS.EXPENSES)),
    getDocs(hotelCollection(hotelId, COLLECTIONS.ROOMS)),
  ]);

  return {
    bookings: [
      ...legacy.docs.map((d) => d.data() as MetricsInput["bookings"][number]),
      ...reservations.docs.map((d) => d.data() as MetricsInput["bookings"][number]),
    ],
    orders: orders.docs.map((d) => d.data() as MetricsInput["orders"][number]),
    events: events.docs.map((d) => d.data() as MetricsInput["events"][number]),
    expenses: expenses.docs.map((d) => d.data() as MetricsInput["expenses"][number]),
    rooms: rooms.docs.map((d) => d.data() as MetricsInput["rooms"][number]),
  };
}
