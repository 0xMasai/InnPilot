import { type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { signOut } from "firebase/auth";
import { auth } from "../../firebase";
import { useAuth, type Role } from "./AuthProvider";
import { Hotel, Clock } from "lucide-react";

const FullScreenSpinner = () => (
  <div
    className="min-h-screen w-full flex flex-col items-center justify-center gap-3 text-slate-400"
    style={{ background: "var(--app-bg)" }}
  >
    <div className="w-8 h-8 rounded-full border-2 border-slate-200 border-t-blue-500 animate-spin" />
    <p className="text-sm">Checking your access…</p>
  </div>
);

const PendingApproval = () => (
  <div
    className="min-h-screen w-full flex items-center justify-center p-6 font-poppins"
    style={{ background: "var(--app-bg)" }}
  >
    <div className="w-full max-w-md card p-8 sm:p-10 text-center">
      <div className="mx-auto w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center mb-4">
        <Clock className="size-6 text-blue-500" />
      </div>
      <div className="flex items-center justify-center gap-2 mb-2 text-slate-800">
        <Hotel className="size-5 text-blue-500" />
        <span className="font-semibold">Hotel Management</span>
      </div>
      <h1 className="text-xl font-bold text-slate-800 mb-2">
        Account awaiting approval
      </h1>
      <p className="text-sm text-slate-500 mb-6">
        Your account was created but has not been approved yet. Ask an
        administrator to activate your access, then sign in again.
      </p>
      <button
        className="btn btn-primary w-full"
        onClick={() => signOut(auth)}
      >
        Sign out
      </button>
    </div>
  </div>
);

interface ProtectedRouteProps {
  children: ReactNode;
  /** Roles allowed to view this route. Defaults to staff + admin. */
  allow?: Role[];
  /** Where to send signed-out visitors (admin routes use /admin/login). */
  loginPath?: string;
}

/**
 * Guards a route behind authentication and role membership.
 * - Signed out            → redirect to login
 * - Signed in, "pending"  → approval-pending screen
 * - Signed in, wrong role → redirect to their own console
 */
export default function ProtectedRoute({
  children,
  allow = ["admin", "staff"],
  loginPath = "/login",
}: ProtectedRouteProps) {
  const { user, role, loading } = useAuth();

  if (loading) return <FullScreenSpinner />;
  if (!user) return <Navigate to={loginPath} replace />;
  if (role === "pending") return <PendingApproval />;
  if (role && !allow.includes(role)) {
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
}
