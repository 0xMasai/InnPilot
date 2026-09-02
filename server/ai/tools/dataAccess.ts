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

/**
 * The hotel's display name, for the prompt's session context.
 *
 * Never load-bearing: the prompt falls back to "this hotel" when this
 * returns null, so a missing document, a hotel with no name, or a read
 * failure costs a nicety and never a turn. Cached with every other read
 * in the turn, so naming the hotel does not add a round-trip to a
 * question that already touches Firestore.
 */
export function fetchHotelName(hotelId: string): Promise<string | null> {
  return cachedRead(`${hotelId}#name`, async () => {
    try {
      const snap = await db.collection("hotels").doc(hotelId).get();
      const name = snap.data()?.name;
      return typeof name === "string" && name.trim() ? name.trim() : null;
    } catch {
      return null;
    }
  });
}

/**
 * ---------------------------------------------------------------------
 * Writes (Phase 10)
 *
 * Two rules separate these from everything above.
 *
 * **They never read through the request cache.** A write decides what to
 * change from what it reads, and the cache exists to hold one snapshot
 * still for the length of a turn — exactly the wrong property here. A
 * confirmed write runs in a *later* request than the proposal that
 * described it, and it must act on the record as it is now, not as it was
 * when the model first looked.
 *
 * **They write the fields `firestore.rules` requires.** The Admin SDK
 * bypasses those rules, so nothing forces the issue — but a document this
 * writes must stay editable from the browser afterwards, and a room with
 * no `hotelId` or a mismatched one is a document the app itself would be
 * refused on update. Consistency with the UI's own writes is the point.
 * ---------------------------------------------------------------------
 */

/** One document, read fresh. `null` when it does not exist. */
export async function readDocUncached<T>(
  hotelId: string,
  collection: string,
  docId: string
): Promise<(T & { id: string }) | null> {
  const snap = await hotelCollection(hotelId, collection).doc(docId).get();
  if (!snap.exists) return null;
  return { ...(snap.data() as T), id: snap.id };
}

/** A whole collection, read fresh — for resolving a target by name. */
export async function listDocsUncached<T>(
  hotelId: string,
  collection: string
): Promise<(T & { id: string })[]> {
  const snap = await hotelCollection(hotelId, collection).get();
  return snap.docs.map((d) => ({ ...(d.data() as T), id: d.id }));
}

/**
 * Update named fields on one document.
 *
 * `hotelId` is stamped alongside whatever is being changed so the document
 * satisfies `tenantFieldOk()` on every later client update. It is written
 * from the server-derived context, never from tool input — a tool cannot
 * move a record into another hotel because it cannot name one.
 */
export async function updateDocFields(
  hotelId: string,
  collection: string,
  docId: string,
  fields: Record<string, unknown>
): Promise<void> {
  await hotelCollection(hotelId, collection)
    .doc(docId)
    .update({ ...fields, hotelId });
}
