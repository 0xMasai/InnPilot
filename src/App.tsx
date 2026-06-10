import { Routes, Route } from "react-router-dom";
import LoginPage from "./pages/login";
import HomePage from "./pages/home";
import SignUpPage from "./pages/signup";
import DashboardShell from "./dashboard";
import AdminLogin from "./pages/admin/login";
import AdminHome from "./pages/admin/dashboard";
import ProfilePage from "./profile";

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<HomePage />} />
      <Route path="/admin/login" element={<AdminLogin />} />
      <Route path="/admin/dashboard" element={<AdminHome />} />
      <Route path="/signup" element={<SignUpPage />} />
      <Route path="/profile" element={<ProfilePage />} />
      <Route
        path="/dashboard"
        element={
          <DashboardShell>
            <p>Welcome to your dashboard!</p>
          </DashboardShell>
        }
      />
    </Routes>
  );
}

export default App;
