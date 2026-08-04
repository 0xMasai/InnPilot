import { Routes, Route, Navigate } from "react-router-dom";
import type { ReactNode } from "react";
import LoginPage from "./pages/login";
import SignUpPage from "./pages/signup";
import AdminLogin from "./pages/admin/login";
import ProfilePage from "./profile";
import DashboardShell from "./dashboard";

import OverviewDashboard from "./Overview";
import AccommodationDashboard from "./Accommodation";
import RestaurantDashboard from "./Restaurant";
import ConferenceDashboard from "./Conference";
import ExpensesDashboard from "./Expenses";
import GuestsDashboard from "./Guests";
import ReportsDashboard from "./Reports";
import UsersDashboard from "./Users";
import AuditLogDashboard from "./AuditLog";

import AdminBookingRecords from "./pages/admin/Accommodation";
import AdminOrderRecords from "./pages/admin/Restaurant";
import AdminEventRecords from "./pages/admin/Conference";
import AdminExpenseRecords from "./pages/admin/Expenses";

import { AuthProvider, useAuth } from "./auth/AuthProvider";
import ProtectedRoute from "./auth/ProtectedRoute";

/** Admin-only nested route; non-admins are sent back to the overview. */
function AdminOnly({ children }: { children: ReactNode }) {
  const { role } = useAuth();
  return role === "admin" ? <>{children}</> : <Navigate to="/dashboard" replace />;
}

function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignUpPage />} />
        <Route path="/admin/login" element={<AdminLogin />} />

        {/* Legacy URL from the old separate admin shell */}
        <Route path="/admin/dashboard" element={<Navigate to="/dashboard" replace />} />

        <Route
          path="/profile"
          element={
            <ProtectedRoute>
              <ProfilePage />
            </ProtectedRoute>
          }
        />

        {/* Unified, role-aware application shell */}
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <DashboardShell />
            </ProtectedRoute>
          }
        >
          <Route index element={<OverviewDashboard />} />
          <Route path="accommodation" element={<AccommodationDashboard />} />
          <Route path="guests" element={<GuestsDashboard />} />
          <Route path="restaurant" element={<RestaurantDashboard />} />
          <Route path="conference" element={<ConferenceDashboard />} />
          <Route path="expenses" element={<ExpensesDashboard />} />
          <Route path="reports" element={<ReportsDashboard />} />

          {/* Admin-only record management (paginated, editable history) */}
          <Route path="records/bookings" element={<AdminOnly><AdminBookingRecords /></AdminOnly>} />
          <Route path="records/orders" element={<AdminOnly><AdminOrderRecords /></AdminOnly>} />
          <Route path="records/events" element={<AdminOnly><AdminEventRecords /></AdminOnly>} />
          <Route path="records/expenses" element={<AdminOnly><AdminExpenseRecords /></AdminOnly>} />

          {/* Admin-only accountability */}
          <Route path="users" element={<AdminOnly><UsersDashboard /></AdminOnly>} />
          <Route path="audit" element={<AdminOnly><AuditLogDashboard /></AdminOnly>} />
        </Route>

        {/* Anything unknown goes to the overview (guards handle auth) */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </AuthProvider>
  );
}

export default App;
