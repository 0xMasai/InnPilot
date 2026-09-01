/**
 * Hotel data loader — the only place AI tools read Firestore.
 *
 * Two jobs, both about agreeing with what the manager already sees:
 *
 * 1. **Same sources as the dashboards.** `Overview.tsx` and `Reports.tsx`
 *    read `accomodation` AND `reservations` and concatenate them into one
 *    `bookings` array before calling `computeMetrics` (see the comment in
 *    Overview.tsx: bookings live in two places today, and reading only one
 *    silently misses any hotel that has moved to the newer front-desk
 *    flow). `bookings()` does exactly the same. Tools that are specifically
 *    about the live front-desk flow use `reservations()` on its own, which
 *    is the subset those PMS pages read.
 *
 * 2. **One read per collection per turn.** A question like "how is the
 *    hotel doing?" legitimately calls several tools; without this cache
 *    each would re-read the same collections. Promises are memoized per
 *    loader instance, and a loader is created once per turn — so it can
 *    never serve data from an earlier request.
 */
import type {
  BookingRecord,
  EventRecord,
  ExpenseRecord,
  MetricsInput,
  OrderRecord,
  RoomRecord,
} from "../../../../src/lib/metrics";
import { COLLECTIONS } from "../../../../src/lib/collections";
import { hotelCollection } from "./paths";

/** A room as the app stores it (see RoomBoard.tsx). */
export interface RoomDoc extends RoomRecord {
  id: string;
  number?: string;
  type?: string;
  price?: number;
}

/** A booking/reservation with its document id, for tools that list them. */
export interface BookingDoc extends BookingRecord {
  id: string;
  reservationNumber?: string;
  roomType?: string;
  totalAmount?: number;
  numberOfGuests?: number;
  bookingSource?: string;
}

export interface HotelData {
  /** accomodation + reservations, exactly as the dashboards combine them. */
  bookings(): Promise<BookingDoc[]>;
  /** reservations only — the live front-desk flow. */
  reservations(): Promise<BookingDoc[]>;
  orders(): Promise<OrderRecord[]>;
  events(): Promise<EventRecord[]>;
  expenses(): Promise<ExpenseRecord[]>;
  rooms(): Promise<RoomDoc[]>;
  /** Everything computeMetrics needs, fetched in parallel. */
  metricsInput(): Promise<MetricsInput>;
}

async function readCollection<T>(hotelId: string, name: string): Promise<T[]> {
  const snap = await hotelCollection(hotelId, name).get();
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as T);
}

/** Memoizes a promise, so N callers in one turn cause one Firestore read. */
function once<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () => (pending ??= load());
}

/**
 * @param hotelId ALWAYS from the server-derived ToolContext — never from a
 *   tool argument or anything the model produced.
 */
export function createHotelData(hotelId: string): HotelData {
  const legacyBookings = once(() =>
    readCollection<BookingDoc>(hotelId, COLLECTIONS.BOOKINGS)
  );
  const reservations = once(() =>
    readCollection<BookingDoc>(hotelId, COLLECTIONS.RESERVATIONS)
  );
  const orders = once(() => readCollection<OrderRecord>(hotelId, COLLECTIONS.RESTAURANT));
  const events = once(() => readCollection<EventRecord>(hotelId, COLLECTIONS.CONFERENCE));
  const expenses = once(() => readCollection<ExpenseRecord>(hotelId, COLLECTIONS.EXPENSES));
  const rooms = once(() => readCollection<RoomDoc>(hotelId, COLLECTIONS.ROOMS));

  const bookings = once(async () => {
    const [legacy, live] = await Promise.all([legacyBookings(), reservations()]);
    return [...legacy, ...live];
  });

  return {
    bookings,
    reservations,
    orders,
    events,
    expenses,
    rooms,
    async metricsInput(): Promise<MetricsInput> {
      const [b, o, e, x, r] = await Promise.all([
        bookings(),
        orders(),
        events(),
        expenses(),
        rooms(),
      ]);
      return { bookings: b, orders: o, events: e, expenses: x, rooms: r };
    },
  };
}
