/**
 * Multi-tenant Firestore paths.
 *
 * Operational data (rooms, bookings, restaurant, conference, expenses,
 * audit log) lives under hotels/{hotelId}/{collection}/{docId}. This is
 * the tenant boundary: Firestore security rules key off the {hotelId}
 * path segment, so a client literally cannot address another hotel's
 * documents without the request itself carrying that hotel's id — and
 * the rules check it belongs to the caller.
 *
 * `users/{uid}` is the one exception and stays top-level (see
 * AuthProvider.tsx) so role/hotelId can be resolved from just a uid,
 * before the app knows which hotel to look in.
 */
import { collection, doc, type CollectionReference, type DocumentReference } from "firebase/firestore";
import { db } from "../../firebase";

export const HOTELS_COLLECTION = "hotels";

/** hotels/{hotelId} */
export function hotelDocRef(hotelId: string): DocumentReference {
  return doc(db, HOTELS_COLLECTION, hotelId);
}

/** hotels/{hotelId}/{name} — e.g. hotelCollection(hotelId, COLLECTIONS.ROOMS) */
export function hotelCollection(hotelId: string, name: string): CollectionReference {
  return collection(db, HOTELS_COLLECTION, hotelId, name);
}

/** hotels/{hotelId}/{name}/{docId} */
export function hotelDoc(hotelId: string, name: string, docId: string): DocumentReference {
  return doc(db, HOTELS_COLLECTION, hotelId, name, docId);
}
