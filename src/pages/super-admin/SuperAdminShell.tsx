// SuperAdminShell — platform-level shell for the Super Admin console.
// Deliberately separate from DashboardShell: a Super Admin manages hotels
// and hotel_admin accounts, not hotel-operational data, so it doesn't need
// the operational notification/toast system that shell carries.
import { useState } from "react";
import {
  LayoutDashboard,
  Hotel,
  LogOut,
  Menu,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import AccountCircleIcon from "@mui/icons-material/AccountCircle";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { auth } from "../../../firebase";
import { useAuth } from "../../auth/AuthProvider";
import innpilotMark from "../../assets/brand/innpilot-mark.png";

type NavItem = { icon: React.ReactNode; label: string; to: string; end?: boolean };

const navItems: NavItem[] = [
  { icon: <LayoutDashboard size={19} />, label: "Overview", to: "/super-admin", end: true },
  { icon: <Hotel size={19} />, label: "Hotels", to: "/super-admin/hotels" },
];

const pageMeta: Record<string, { title: string; subtitle: string }> = {
  "/super-admin": { title: "Platform Overview", subtitle: "Hotels, subscriptions and activity" },
  "/super-admin/hotels": { title: "Hotels", subtitle: "Create and manage hotel tenants" },
};

export default function SuperAdminShell() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  const userName = user?.displayName || user?.email || "Super Admin";
  const meta =
    pageMeta[location.pathname] ??
    (location.pathname.startsWith("/super-admin/hotels/")
      ? { title: "Hotel Detail", subtitle: "Manage this hotel's admin and subscription" }
      : { title: "Super Admin", subtitle: "" });

  const handleLogout = async () => {
    try {
      await auth.signOut();
      navigate("/login", { replace: true });
    } catch (err) {
      console.error("Error logging out:", err);
    }
  };

  const NavContent = ({ onNavigate }: { onNavigate?: () => void }) => (
    <>
      <div className="flex items-center gap-2.5 px-5 h-16 border-b border-[var(--rail-border)]">
        <img src={innpilotMark} alt="InnPilot" className="w-9 h-9 object-contain" />
        <div className="leading-tight">
          <p className="text-[15px] font-semibold text-white tracking-tight">InnPilot</p>
          <p className="text-[11px] text-[var(--rail-text-muted)]">Platform Console</p>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={onNavigate}
            className={({ isActive }) =>
              `relative flex items-center gap-3 w-full px-3 py-2.5 rounded-lg transition-all text-[14.5px] ${
                isActive
                  ? "bg-[var(--rail-active)] text-white font-medium"
                  : "text-[var(--rail-text)] hover:bg-white/5 hover:text-white"
              }`
            }
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 rounded-r bg-[var(--brand-cyan)]" />
                )}
                <span className={isActive ? "text-[var(--brand-cyan)]" : ""}>{item.icon}</span>
                <span>{item.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="p-3 border-t border-[var(--rail-border)]">
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/5 transition text-[var(--rail-text)] w-full"
          aria-label="Sign out"
        >
          <AccountCircleIcon className="w-8 h-8 text-slate-400" />
          <div className="flex-1 text-left leading-tight">
            <div className="text-sm font-semibold text-white truncate">{userName}</div>
            <div className="text-xs text-[var(--rail-text-muted)]">Sign out</div>
          </div>
          <LogOut size={17} className="text-[var(--rail-text-muted)]" />
        </button>
      </div>
    </>
  );

  return (
    <div className="flex min-h-screen" style={{ background: "var(--bg)" }}>
      {/* DESKTOP SIDEBAR */}
      <aside
        className="hidden md:flex flex-col fixed top-0 left-0 h-full w-[264px] z-30"
        style={{ background: "var(--rail)", borderRight: "1px solid var(--rail-border)" }}
      >
        <NavContent />
      </aside>

      {/* MOBILE DRAWER */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-slate-900/50 z-40 md:hidden"
              onClick={() => setMobileOpen(false)}
            />
            <motion.aside
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ type: "spring", stiffness: 300, damping: 32 }}
              className="fixed top-0 left-0 h-full w-[264px] z-50 flex flex-col md:hidden"
              style={{ background: "var(--rail)", borderRight: "1px solid var(--rail-border)" }}
            >
              <NavContent onNavigate={() => setMobileOpen(false)} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* MAIN CONTENT */}
      <div className="flex flex-col flex-1 min-h-0 min-w-0 ml-0 md:ml-[264px]">
        <header
          className="flex items-center gap-4 px-4 sm:px-6 h-16 sticky top-0 z-20 bg-white/85 backdrop-blur-md"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <button
            className="md:hidden p-2 rounded-lg hover:bg-slate-100 transition text-slate-600"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
          >
            <Menu size={20} />
          </button>
          <div className="min-w-0">
            <h1 className="text-[15px] font-semibold text-slate-800 truncate leading-tight">
              {meta.title}
            </h1>
            <p className="text-xs text-slate-400 truncate">{meta.subtitle}</p>
          </div>
        </header>

        <main className="flex-1 min-h-0 overflow-auto">
          <div className="mx-auto w-full max-w-[1400px] px-4 sm:px-6 py-6">
            <Outlet />
          </div>
          <footer className="px-6 py-4 border-t border-slate-200 text-xs text-slate-400 text-center">
            © {new Date().getFullYear()} InnPilot · Platform Console
          </footer>
        </main>
      </div>
    </div>
  );
}
