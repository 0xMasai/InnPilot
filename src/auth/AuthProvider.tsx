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

    const unsubAuth = onAuthStateChanged(auth, (u) => {
      unsubRole?.();
      unsubRole = undefined;

      setUser(u);

      if (!u) {
        setRole(null);
        setHotelId(null);
        setLoading(false);
        return;
      }

      unsubRole = onSnapshot(
        doc(db, "users", u.uid),
        (snap) => {
          const data = snap.exists() ? snap.data() : undefined;
          const r = data?.role as Role | undefined;
          const validRole =
            r === "super_admin" || r === "hotel_admin" || r === "staff" ? r : "pending";
          setRole(validRole);
          setHotelId(
            validRole === "super_admin" ? null : ((data?.hotelId as string | undefined) ?? null)
          );
          setLoading(false);
        },
        () => {
          // Firestore rules denied the read or the doc is unreadable:
          // treat as unapproved rather than crashing.
          setRole("pending");
          setHotelId(null);
          setLoading(false);
        }
      );
    });

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
