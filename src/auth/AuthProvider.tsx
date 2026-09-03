import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { onAuthStateChanged, type User as FirebaseUser } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, db } from "../../firebase";
import type { Role } from "../types/models";

export type { Role };

interface AuthState {
  user: FirebaseUser | null;
  role: Role | null; // null while loading or signed out
  /** null for super_admin (and while loading/signed out). */
  hotelId: string | null;
  loading: boolean;
}

const AuthContext = createContext<AuthState>({
  user: null,
  role: null,
  hotelId: null,
  loading: true,
});

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthContext);

/**
 * Single source of truth for auth state, role, and hotel membership.
 * Both are read live from users/{uid} so an admin change (approving,
 * reassigning) takes effect without the user re-logging in.
 *
 * users/{uid} stays a top-level collection (not hotel-scoped) precisely
 * so this lookup works from a bare uid, before we know which hotel — see
 * src/lib/hotelScope.ts.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [hotelId, setHotelId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsubRole: (() => void) | undefined;

    // Firebase Auth is the only source of truth. Role and hotel come from
    // the real users/{uid} document — provisioned by a super_admin or the
    // bootstrap script, never by the client — and nothing is assumed when
    // that document is missing or unreadable.
    const unsubAuth = onAuthStateChanged(
      auth,
      (u) => {
        unsubRole?.();
        unsubRole = undefined;

        if (!u) {
          setUser(null);
          setRole(null);
          setHotelId(null);
          setLoading(false);
          return;
        }

        setUser(u);
        unsubRole = onSnapshot(
          doc(db, "users", u.uid),
          (snap) => {
            const data = snap.exists() ? snap.data() : undefined;
            const r = data?.role as Role | undefined;
            // Fail closed: an unprovisioned or unknown account is "pending",
            // never an implicit admin. Only a real users/{uid} doc grants
            // hotel access, and only super_admin has a null hotel.
            const validRole: Role =
              r === "super_admin" || r === "hotel_admin" || r === "staff" || r === "pending"
                ? r
                : "pending";
            setRole(validRole);
            setHotelId(
              validRole === "super_admin"
                ? null
                : ((data?.hotelId as string | undefined) ?? null)
            );
            setLoading(false);
          },
          () => {
            // A denied or failed profile read is not a licence to assume
            // access. Treat it as not-yet-active.
            setRole("pending");
            setHotelId(null);
            setLoading(false);
          }
        );
      },
      () => {
        setUser(null);
        setRole(null);
        setHotelId(null);
        setLoading(false);
      }
    );

    return () => {
      unsubAuth();
      unsubRole?.();
    };
  }, []);

  return (
    <AuthContext.Provider value={{ user, role, hotelId, loading }}>
      {children}
    </AuthContext.Provider>
  );
}
