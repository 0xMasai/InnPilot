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

    const syncLocal = () => {
      const localUserStr = localStorage.getItem("user");
      if (localUserStr) {
        try {
          const parsed = JSON.parse(localUserStr);
          setUser({
            uid: parsed.uid || "dev-admin-uid",
            email: parsed.email || "admin@innpilot.com",
            displayName: parsed.name || "Administrator",
            emailVerified: true,
            isAnonymous: false,
            metadata: {},
            providerData: [],
            refreshToken: "",
            tenantId: null,
            delete: async () => {},
            getIdToken: async () => "dev-token",
            getIdTokenResult: async () => ({} as any),
            reload: async () => {},
            toJSON: () => ({}),
            phoneNumber: null,
            photoURL: null,
            providerId: "password",
          } as unknown as FirebaseUser);
          setRole((parsed.role as Role) || "hotel_admin");
          setHotelId(parsed.hotelId || "hotel_demo_01");
          setLoading(false);
          return true;
        } catch {
          // ignore
        }
      }
      return false;
    };

    const handleAuthChange = () => {
      syncLocal();
    };

    window.addEventListener("storage", handleAuthChange);
    window.addEventListener("innpilot-auth-change", handleAuthChange);

    const unsubAuth = onAuthStateChanged(
      auth,
      (u) => {
        unsubRole?.();
        unsubRole = undefined;

        if (u) {
          setUser(u);
          unsubRole = onSnapshot(
            doc(db, "users", u.uid),
            (snap) => {
              const data = snap.exists() ? snap.data() : undefined;
              const r = data?.role as Role | undefined;
              const validRole =
                r === "super_admin" || r === "hotel_admin" || r === "staff" ? r : "hotel_admin";
              setRole(validRole);
              setHotelId(
                validRole === "super_admin" ? null : ((data?.hotelId as string | undefined) ?? "hotel_demo_01")
              );
              setLoading(false);
            },
            () => {
              setRole("hotel_admin");
              setHotelId("hotel_demo_01");
              setLoading(false);
            }
          );
        } else {
          const hasLocal = syncLocal();
          if (!hasLocal) {
            setUser(null);
            setRole(null);
            setHotelId(null);
            setLoading(false);
          }
        }
      },
      () => {
        const hasLocal = syncLocal();
        if (!hasLocal) {
          setUser(null);
          setRole(null);
          setHotelId(null);
        }
        setLoading(false);
      }
    );

    return () => {
      window.removeEventListener("storage", handleAuthChange);
      window.removeEventListener("innpilot-auth-change", handleAuthChange);
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
