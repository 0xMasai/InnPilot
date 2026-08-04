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

export type Role = "admin" | "staff" | "pending";

interface AuthState {
  user: FirebaseUser | null;
  role: Role | null; // null while loading or signed out
  loading: boolean;
}

const AuthContext = createContext<AuthState>({
  user: null,
  role: null,
  loading: true,
});

export const useAuth = () => useContext(AuthContext);

/**
 * Single source of truth for auth state and the user's role.
 * Role is read live from users/{uid} so an admin approving an account
 * takes effect without the user re-logging in.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsubRole: (() => void) | undefined;

    const unsubAuth = onAuthStateChanged(auth, (u) => {
      unsubRole?.();
      unsubRole = undefined;

      setUser(u);

      if (!u) {
        setRole(null);
        setLoading(false);
        return;
      }

      unsubRole = onSnapshot(
        doc(db, "users", u.uid),
        (snap) => {
          const r = snap.exists() ? (snap.data().role as Role | undefined) : undefined;
          setRole(r === "admin" || r === "staff" ? r : "pending");
          setLoading(false);
        },
        () => {
          // Firestore rules denied the read or the doc is unreadable:
          // treat as unapproved rather than crashing.
          setRole("pending");
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
    <AuthContext.Provider value={{ user, role, loading }}>
      {children}
    </AuthContext.Provider>
  );
}
