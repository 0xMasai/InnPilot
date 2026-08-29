/**
 * Admin-initiated account creation (Super Admin → hotel_admin,
 * Hotel Admin → staff).
 *
 * Why this exists: this project has no backend (no Cloud Functions, no
 * Admin SDK server) — it's a pure client app talking directly to
 * Firebase. `createUserWithEmailAndPassword` is not a privileged call;
 * it's the same public signup endpoint anyone can call with the
 * project's public apiKey. The real security boundary is what role
 * Firestore *lets you write* to users/{uid} (enforced in firestore.rules),
 * not who is allowed to create an Auth account.
 *
 * The one real problem is a UX/session one: calling
 * createUserWithEmailAndPassword() on the app's normal `auth` instance
 * signs the browser in as the *new* user, kicking out the admin who was
 * doing the creating. We avoid that by creating the account on a second,
 * throwaway Firebase App instance (same project, same public config) so
 * the admin's primary session on `auth` is never touched. The new
 * user's profile doc is then written using the *primary* session's
 * Firestore access (as the admin), which is what security rules check.
 *
 * No Admin SDK, no server, no secrets exposed — just two client SDK
 * instances pointed at the same project.
 */
import {
  getApps,
  initializeApp,
  type FirebaseApp,
} from "firebase/app";
import {
  createUserWithEmailAndPassword,
  getAuth,
  signOut,
  updateProfile,
} from "firebase/auth";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../../firebase";
import { firebaseConfig } from "../../firebase";
import type { Role } from "../types/models";

const SECONDARY_APP_NAME = "hotelms-account-creation";

function getSecondaryApp(): FirebaseApp {
  const existing = getApps().find((a) => a.name === SECONDARY_APP_NAME);
  return existing ?? initializeApp(firebaseConfig, SECONDARY_APP_NAME);
}

export interface CreateAccountInput {
  name: string;
  email: string;
  password: string;
  role: Role;
  hotelId: string | null;
  /** uid of the admin performing the creation, for the audit trail. */
  createdBy: string;
}

export interface CreateAccountResult {
  uid: string;
}

/**
 * Creates a new Firebase Auth user + users/{uid} profile doc, without
 * disturbing the current (admin) session. Always call this from a
 * super_admin (creating a hotel_admin) or a hotel_admin (creating staff
 * for their own hotel) — Firestore rules enforce that only those role
 * combinations are allowed to write the resulting profile doc.
 */
export async function createManagedAccount(
  input: CreateAccountInput
): Promise<CreateAccountResult> {
  const secondaryApp = getSecondaryApp();
  const secondaryAuth = getAuth(secondaryApp);

  try {
    const credential = await createUserWithEmailAndPassword(
      secondaryAuth,
      input.email,
      input.password
    );
    const newUser = credential.user;
    await updateProfile(newUser, { displayName: input.name });

    // Written via the PRIMARY app's `db` — i.e. as the admin who is
    // still signed in there. This is the call Firestore rules evaluate.
    await setDoc(doc(db, "users", newUser.uid), {
      uid: newUser.uid,
      name: input.name,
      email: input.email,
      role: input.role,
      hotelId: input.hotelId,
      createdAt: serverTimestamp(),
      createdBy: input.createdBy,
    });

    return { uid: newUser.uid };
  } finally {
    // Always drop the secondary session, whether creation succeeded or
    // not, so a half-created account can't linger as a live session.
    try {
      await signOut(secondaryAuth);
    } catch {
      // no-op: nothing was ever signed in
    }
  }
}
