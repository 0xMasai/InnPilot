/**
 * Multi-tenant Firestore paths, Admin SDK side.
 *
 * The server-side mirror of `src/lib/hotelScope.ts`, which cannot be shared
 * because it is bound to the client SDK's `db`. The path shape is the
 * contract that matters and it is identical: every piece of operational
 * data lives under hotels/{hotelId}/{collection}.
 *
 * No function here takes a hotelId from a caller-controlled source — the
 * hotelId always comes from the server-derived ToolContext.
 */
import { db } from "../../admin";

export const HOTELS_COLLECTION = "hotels";

/** hotels/{hotelId} */
export function hotelDocRef(hotelId: string) {
  return db.collection(HOTELS_COLLECTION).doc(hotelId);
}

/** hotels/{hotelId}/{name} */
export function hotelCollection(hotelId: string, name: string) {
  return hotelDocRef(hotelId).collection(name);
}

/** hotels/{hotelId}/{name}/{docId} */
export function hotelDoc(hotelId: string, name: string, docId: string) {
  return hotelCollection(hotelId, name).doc(docId);
}
