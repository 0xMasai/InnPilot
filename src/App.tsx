import { Routes, Route, Navigate } from "react-router-dom";
import LoginPage from "./pages/login";
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
import RoomBoard from "./pages/pms/RoomBoard";
import FrontDesk from "./pages/pms/FrontDesk";
import Reservations from "./pages/pms/Reservations";
import AdminBookingRecords from "./pages/admin/Accommodation";
import AdminOrderRecords from "./pages/admin/Restaurant";
import AdminEventRecords from "./pages/admin/Conference";
import AdminExpenseRecords from "./pages/admin/Expenses";
import SuperAdminShell from "./pages/super-admin/SuperAdminShell";
import SuperAdminOverview from "./pages/super-admin/Overview";
import SuperAdminHotels from "./pages/super-admin/Hotels";
import SuperAdminHotelDetail from "./pages/super-admin/HotelDetail";
import { AuthProvider } from "./auth/AuthProvider";
import ProtectedRoute from "./auth/ProtectedRoute";

function App() {
  return <AuthProvider><Routes>
    <Route path="/" element={<Navigate to="/login" replace />} />
    <Route path="/login" element={<LoginPage />} />
    <Route path="/admin/dashboard" element={<Navigate to="/dashboard" replace />} />
    <Route path="/admin/login" element={<Navigate to="/login" replace />} />
    <Route path="/signup" element={<Navigate to="/login" replace />} />
    <Route path="/profile" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
    <Route path="/dashboard" element={<ProtectedRoute allow={["hotel_admin", "staff"]}><DashboardShell /></ProtectedRoute>}>
      <Route index element={<OverviewDashboard />} />
      <Route path="front-desk" element={<FrontDesk />} />
      <Route path="reservations" element={<Reservations />} />
      <Route path="room-board" element={<RoomBoard />} />
      <Route path="accommodation" element={<AccommodationDashboard />} />
      <Route path="guests" element={<GuestsDashboard />} />
      <Route path="restaurant" element={<RestaurantDashboard />} />
      <Route path="conference" element={<ConferenceDashboard />} />
      <Route path="expenses" element={<ExpensesDashboard />} />
      <Route path="reports" element={<ReportsDashboard />} />
      <Route path="records/bookings" element={<ProtectedRoute allow={["hotel_admin"]} redirectTo="/dashboard"><AdminBookingRecords /></ProtectedRoute>} />
      <Route path="records/orders" element={<ProtectedRoute allow={["hotel_admin"]} redirectTo="/dashboard"><AdminOrderRecords /></ProtectedRoute>} />
      <Route path="records/events" element={<ProtectedRoute allow={["hotel_admin"]} redirectTo="/dashboard"><AdminEventRecords /></ProtectedRoute>} />
      <Route path="records/expenses" element={<ProtectedRoute allow={["hotel_admin"]} redirectTo="/dashboard"><AdminExpenseRecords /></ProtectedRoute>} />
      <Route path="users" element={<ProtectedRoute allow={["hotel_admin"]} redirectTo="/dashboard"><UsersDashboard /></ProtectedRoute>} />
      <Route path="audit" element={<ProtectedRoute allow={["hotel_admin"]} redirectTo="/dashboard"><AuditLogDashboard /></ProtectedRoute>} />
    </Route>
    <Route path="/super-admin" element={<ProtectedRoute allow={["super_admin"]} redirectTo="/dashboard"><SuperAdminShell /></ProtectedRoute>}>
      <Route index element={<SuperAdminOverview />} />
      <Route path="hotels" element={<SuperAdminHotels />} />
      <Route path="hotels/:hotelId" element={<SuperAdminHotelDetail />} />
    </Route>
    <Route path="*" element={<Navigate to="/dashboard" replace />} />
  </Routes></AuthProvider>;
}

export default App;
