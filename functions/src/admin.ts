/**
 * Single Firebase Admin app instance, shared by every module in this
 * package — mirrors the frontend's single `db`/`auth` exports in
 * `firebase.ts`, but on the Admin SDK, which bypasses `firestore.rules`
 * entirely. That's expected and fine here: the Permission Guard is what
 * enforces authorization on this side, not the security rules.
 */
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

export const adminApp = getApps().length ? getApps()[0] : initializeApp();
export const db = getFirestore(adminApp);
