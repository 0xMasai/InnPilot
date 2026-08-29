/**
 * Multi-tenant identity model.
 *
 * - "super_admin" operates the platform: creates hotels and hotel_admin
 *   accounts. hotelId is always null.
 * - "hotel_admin" and "staff" belong to exactly one hotel (hotelId set).
 * - "pending" is retained only for legacy/manually-created rows; public
 *   self-signup has been removed, so nothing produces this role anymore.
 */
export type Role = "super_admin" | "hotel_admin" | "staff" | "pending";

export type SubscriptionPlan = "trial" | "basic" | "pro";
export type SubscriptionStatus = "active" | "past_due" | "suspended" | "cancelled";

export interface HotelSubscription {
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
}

/** hotels/{hotelId} */
export interface HotelDoc {
  name: string;
  location: string;
  subscription: HotelSubscription;
  createdAt?: unknown; // Firestore server timestamp
  createdBy?: string; // uid of the super_admin who created it
}

/** users/{uid} — stays top-level; see src/lib/hotelScope.ts for why. */
export interface UserDoc {
  uid: string;
  name?: string;
  email?: string;
  role: Role;
  /** null for super_admin, otherwise the hotel this account belongs to. */
  hotelId: string | null;
  createdAt?: unknown;
  createdBy?: string; // uid of the admin who created this account
}
