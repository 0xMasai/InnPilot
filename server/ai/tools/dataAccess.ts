/**
 * Firestore access for tools — the Admin-SDK counterpart of
 * `src/lib/hotelScope.ts`.
 *
 * That module builds the same paths with the client SDK, which tools can't
 * use; the path shape (`hotels/{hotelId}/{collection}`) and the reason for
 * it are documented there and are the tenant boundary this file honours.
 * Every function here takes `hotelId` from the server-derived ToolContext
 * — no tool ever accepts one from the model.
 *
 * Collection names come from `src/lib/collections.ts`, so a rename there
 * moves the AI with the app rather than leaving it reading a dead path.
 */
import { db } from "../../admin";
import { cachedRead } from "../requestCache";
import { COLLECTIONS } from "../../../src/lib/collections";
import type {
  BookingRecord,
  EventRecord,
  ExpenseRecord,
  MetricsInput,
  OrderRecord,
  RoomRecord,
} from "../../../src/lib/metrics";

/** hotels/{hotelId}/{name} */
function hotelCollection(hotelId: string, name: string) {
  return db.collection("hotels").doc(hotelId).collection(name);
}

/**
 * Reads go through the per-request cache, so two tools in the same turn
 * that need the same collection issue one query between them. Outside a
 * request scope (a script, a test) this is a plain read.
 */
function fetchAll<T>(hotelId: string, name: string): Promise<T[]> {
  return cachedRead(`${hotelId}/${name}`, async () => {
    const snap = await hotelCollection(hotelId, name).get();
    return snap.docs.map((d) => d.data() as T);
  });
}

/** Same, keeping each document's id — for tools that list records. */
function fetchAllWithIds<T>(
  hotelId: string,
  name: string
): Promise<(T & { id: string })[]> {
  return cachedRead(`${hotelId}/${name}#withIds`, async () => {
    const snap = await hotelCollection(hotelId, name).get();
    return snap.docs.map((d) => ({ ...(d.data() as T), id: d.id }));
  });
}

/**
 * Bookings live in two collections today: the legacy `accomodation` one
 * and the `reservations` one the front-desk flow writes. `Overview.tsx`
 * and `Reports.tsx` read both and combine them; tools do the same, or the
 * assistant's occupancy and revenue would disagree with the dashboards
 * for any hotel using the newer flow.
 */
export async function fetchBookings(hotelId: string): Promise<BookingRecord[]> {
  const [legacy, reservations] = await Promise.all([
    fetchAll<BookingRecord>(hotelId, COLLECTIONS.BOOKINGS),
    fetchAll<BookingRecord>(hotelId, COLLECTIONS.RESERVATIONS),
  ]);
  return [...legacy, ...reservations];
}

export function fetchRooms(hotelId: string): Promise<RoomRecord[]> {
  return fetchAll<RoomRecord>(hotelId, COLLECTIONS.ROOMS);
}

export function fetchOrders(hotelId: string): Promise<OrderRecord[]> {
  return fetchAll<OrderRecord>(hotelId, COLLECTIONS.RESTAURANT);
}

export function fetchEvents(hotelId: string): Promise<EventRecord[]> {
  return fetchAll<EventRecord>(hotelId, COLLECTIONS.CONFERENCE);
}

export function fetchExpenses(hotelId: string): Promise<ExpenseRecord[]> {
  return fetchAll<ExpenseRecord>(hotelId, COLLECTIONS.EXPENSES);
}

export function fetchReservations<T>(
  hotelId: string
): Promise<(T & { id: string })[]> {
  return fetchAllWithIds<T>(hotelId, COLLECTIONS.RESERVATIONS);
}

export function fetchRoomsWithIds<T>(
  hotelId: string
): Promise<(T & { id: string })[]> {
  return fetchAllWithIds<T>(hotelId, COLLECTIONS.ROOMS);
}

/** Everything `computeMetrics` needs, fetched in parallel. */
export async function fetchMetricsInput(hotelId: string): Promise<MetricsInput> {
  const [bookings, orders, events, expenses, rooms] = await Promise.all([
    fetchBookings(hotelId),
    fetchOrders(hotelId),
    fetchEvents(hotelId),
    fetchExpenses(hotelId),
    fetchRooms(hotelId),
  ]);
  return { bookings, orders, events, expenses, rooms };
}
