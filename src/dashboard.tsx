// DashboardShell — unified, role-aware application shell.
// Modules render via nested routes (<Outlet/>); the sidebar is NavLink-based
// so every module is deep-linkable and survives a refresh.
import { useState, useEffect, useRef } from "react";
import {
  LayoutDashboard,
  LogOut,
  Menu,
  Bell,
  Search,
  BedDouble,
  Utensils,
  Briefcase,
  PieChart,
  ClipboardList,
  ReceiptText,
  CalendarDays,
  Wallet,
  Users,
  FileText,
  ShieldCheck,
  // Sparkles, // Ask InnPilot disabled for V1 (kept for re-enable)
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import Tippy from "@tippyjs/react";
import "tippy.js/dist/tippy.css";
import AccountCircleIcon from "@mui/icons-material/AccountCircle";
import innpilotMark from "./assets/brand/innpilot-mark.png";

import { auth, db } from "../firebase";
import { doc, getDoc, onSnapshot } from "firebase/firestore";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "./auth/AuthProvider";
import { COLLECTIONS } from "./lib/collections";
import { hotelCollection } from "./lib/hotelScope";
import WebMCPStatusBadge from "./webmcp/WebMCPStatusBadge";

type NotificationItem = {
  id: string;
  type:
    | "Restaurant Order"
    | "Room Booking"
    | "Conference Booking"
    | "Expense Entry";
  timestamp: Date;
  data: Record<string, unknown>;
  summary?: string;
};

// Toast type
type ToastItem = {
  id: string;
  message: string;
  type: NotificationItem["type"];
};

type NavItem = {
  icon: React.ReactNode;
  label: string;
  to: string;
  end?: boolean;
};

type NavGroup = { label: string; items: NavItem[] };

const baseNav: NavGroup[] = [
  {
    label: "Operations",
    items: [
      { icon: <LayoutDashboard size={19} />, label: "Overview", to: "/dashboard", end: true },
      // { icon: <Sparkles size={19} />, label: "Ask InnPilot", to: "/dashboard/ask" }, // disabled for V1
      { icon: <BedDouble size={19} />, label: "Accommodation", to: "/dashboard/accommodation" },
      { icon: <Users size={19} />, label: "Guests", to: "/dashboard/guests" },
    ],
  },
  {
    label: "Services",
    items: [
      { icon: <Utensils size={19} />, label: "Restaurant", to: "/dashboard/restaurant" },
      { icon: <Briefcase size={19} />, label: "Conference", to: "/dashboard/conference" },
    ],
  },
  {
    label: "Finance",
    items: [
      { icon: <PieChart size={19} />, label: "Expenses", to: "/dashboard/expenses" },
      { icon: <FileText size={19} />, label: "Reports", to: "/dashboard/reports" },
    ],
  },
];

// Admin-only: paginated record management (edit history, corrections).
const adminNav: NavGroup[] = [
  {
    label: "Records",
    items: [
      { icon: <ClipboardList size={19} />, label: "Bookings", to: "/dashboard/records/bookings" },
      { icon: <ReceiptText size={19} />, label: "Orders", to: "/dashboard/records/orders" },
      { icon: <CalendarDays size={19} />, label: "Events", to: "/dashboard/records/events" },
      { icon: <Wallet size={19} />, label: "Expenses", to: "/dashboard/records/expenses" },
    ],
  },
  {
    label: "Administration",
    items: [
      { icon: <Users size={19} />, label: "Staff & Users", to: "/dashboard/users" },
      { icon: <ShieldCheck size={19} />, label: "Audit Log", to: "/dashboard/audit" },
    ],
  },
];

const pageMeta: Record<string, { title: string; subtitle: string }> = {
  "/dashboard": { title: "Overview", subtitle: "Today's performance at a glance" },
  "/dashboard/ask": { title: "Ask InnPilot", subtitle: "Answers drawn from this hotel's live records" },
  "/dashboard/accommodation": { title: "Accommodation", subtitle: "Rooms, bookings and availability" },
  "/dashboard/guests": { title: "Guests", subtitle: "Profiles, stay history and balances" },
  "/dashboard/restaurant": { title: "Restaurant", subtitle: "Orders and dining service" },
  "/dashboard/conference": { title: "Conference", subtitle: "Meeting spaces and events" },
  "/dashboard/expenses": { title: "Expenses", subtitle: "Operational spending" },
  "/dashboard/reports": { title: "Reports", subtitle: "Management reports, print and export" },
  "/dashboard/records/bookings": { title: "Booking Records", subtitle: "Review and edit booking history" },
  "/dashboard/records/orders": { title: "Order Records", subtitle: "Review and edit restaurant orders" },
  "/dashboard/records/events": { title: "Event Records", subtitle: "Review and edit conference bookings" },
  "/dashboard/records/expenses": { title: "Expense Records", subtitle: "Review and edit recorded expenses" },
  "/dashboard/users": { title: "Staff & Users", subtitle: "Approve accounts and manage roles" },
  "/dashboard/audit": { title: "Audit Log", subtitle: "Append-only record of important actions" },
};

// PROFILE MENU
const ProfileMenu: React.FC<{ userName: string }> = ({ userName }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleLogout = async () => {
    try {
      await auth.signOut();
      localStorage.clear();
      sessionStorage.clear();
      navigate("/login", { replace: true });
    } catch (err) {
      console.error("Error logging out:", err);
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        className="flex items-center gap-2 p-1.5 pr-2 rounded-lg hover:bg-slate-100 transition"
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <AccountCircleIcon className="w-8 h-8 text-slate-400" />
        <span className="hidden sm:block text-sm font-medium text-slate-700">
          {userName}
        </span>
      </button>

      {open && (
        <div
          className="absolute right-0 mt-2 w-52 bg-white border border-slate-200 rounded-xl shadow-lg z-50 overflow-hidden"
          role="menu"
        >
          <div className="px-4 py-3 border-b border-slate-100">
            <p className="text-sm font-semibold text-slate-800 truncate">{userName}</p>
            <p className="text-xs text-slate-400">Staff account</p>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 w-full px-4 py-2.5 hover:bg-slate-50 transition text-sm text-rose-600 font-medium"
            role="menuitem"
          >
            <LogOut size={16} />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
};

// Shared sidebar content (used by desktop rail and mobile drawer)
const SidebarContent: React.FC<{
  collapsed: boolean;
  groups: NavGroup[];
  consoleLabel: string;
  userName: string;
  onNavigate?: () => void;
  onLogout: () => void;
  onToggleCollapse?: () => void;
  showCollapseBtn?: boolean;
}> = ({ collapsed, groups, consoleLabel, userName, onNavigate, onLogout, onToggleCollapse, showCollapseBtn }) => (
  <>
    <div
      className={`flex items-center border-b border-[var(--rail-border)] h-16 ${
        collapsed ? "flex-col justify-center gap-1 px-2 py-2" : "justify-between px-5"
      }`}
    >
      {!collapsed && (
        <div className="flex items-center gap-2.5 min-w-0">
          <img src={innpilotMark} alt="InnPilot" className="w-9 h-9 shrink-0 object-contain" />
          <div className="leading-tight min-w-0">
            <p className="text-[15px] font-semibold text-white tracking-tight truncate">InnPilot</p>
            <p className="text-[11px] text-[var(--rail-text-muted)] truncate">{consoleLabel}</p>
          </div>
        </div>
      )}
      {collapsed && (
        <img src={innpilotMark} alt="InnPilot" className="w-7 h-7 object-contain" />
      )}
      {showCollapseBtn && (
        <button
          onClick={onToggleCollapse}
          className={`rounded-lg hover:bg-white/10 transition text-slate-300 ${collapsed ? "p-1" : "p-2"}`}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <Menu size={collapsed ? 16 : 20} />
        </button>
      )}
    </div>

    <nav className="flex-1 px-3 py-4 space-y-5 overflow-y-auto">
      {groups.map((group) => (
        <div key={group.label}>
          {!collapsed && (
            <p className="px-3 mb-1.5 text-[11px] font-bold uppercase tracking-wider text-[var(--rail-text-muted)]">
              {group.label}
            </p>
          )}
          <div className="space-y-1">
            {group.items.map((item) => (
              <Tippy
                key={item.to}
                content={collapsed ? item.label : ""}
                placement="right"
                disabled={!collapsed}
              >
                <NavLink
                  to={item.to}
                  end={item.end}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    `relative flex items-center w-full px-3 py-2.5 rounded-lg transition-all text-[14.5px]
                    ${collapsed ? "justify-center" : "gap-3"}
                    ${
                      isActive
                        ? "bg-[var(--rail-active)] text-white font-medium"
                        : "text-[var(--rail-text)] hover:bg-white/5 hover:text-white"
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && !collapsed && (
                        <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 rounded-r bg-[var(--brand-cyan)]" />
                      )}
                      <span className={isActive ? "text-[var(--brand-cyan)]" : ""}>{item.icon}</span>
                      {!collapsed && <span>{item.label}</span>}
                    </>
                  )}
                </NavLink>
              </Tippy>
            ))}
          </div>
        </div>
      ))}
    </nav>

    <div className="p-3 border-t border-[var(--rail-border)]">
      <button
        onClick={onLogout}
        className={`flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/5 transition text-[var(--rail-text)] w-full ${
          collapsed ? "justify-center" : ""
        }`}
        aria-label="Sign out"
      >
        <AccountCircleIcon className="w-8 h-8 text-slate-400" />
        {!collapsed && (
          <div className="flex-1 text-left leading-tight">
            <div className="text-sm font-semibold text-white truncate">{userName}</div>
            <div className="text-xs text-[var(--rail-text-muted)]">Sign out</div>
          </div>
        )}
        {!collapsed && <LogOut size={17} className="text-[var(--rail-text-muted)]" />}
      </button>
    </div>
  </>
);

// MAIN SHELL
const DashboardShell: React.FC = () => {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userName, setUserName] = useState("Loading...");
  const navigate = useNavigate();
  const location = useLocation();
  const { user, role, hotelId } = useAuth();

  const sidebarWidthExpanded = 264;
  const sidebarWidthCollapsed = 76;

  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const notifRef = useRef<HTMLDivElement | null>(null);
  const notifBtnRef = useRef<HTMLButtonElement | null>(null);
  const notifSound = useRef<HTMLAudioElement | null>(null);

  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const groups = role === "hotel_admin" ? [...baseNav, ...adminNav] : baseNav;
  const consoleLabel = role === "hotel_admin" ? "Admin Console" : "Staff Console";

  const icons: Record<NotificationItem["type"], React.ReactNode> = {
    "Restaurant Order": <Utensils size={16} className="text-orange-500" />,
    "Room Booking": <BedDouble size={16} className="text-blue-500" />,
    "Conference Booking": <Briefcase size={16} className="text-purple-500" />,
    "Expense Entry": <PieChart size={16} className="text-green-600" />,
  };

  // Convert Firestore data into readable summary.
  // Field names below match the documents each module actually writes.
  const generateSummary = (type: NotificationItem["type"], data: Record<string, unknown>) => {
    const ugx = (v: unknown) => Number(v || 0).toLocaleString();
    switch (type) {
      case "Restaurant Order":
        return `${data.clientName ?? "A client"} ordered ${data.category ?? "an item"} @ UGX ${ugx(data.price)}`;
      case "Room Booking":
        return `${data.guestName ?? "A guest"} booked ${
          data.roomNumber ? `room ${data.roomNumber}` : "a room"
        } (${data.roomType ?? "-"}) @ UGX ${ugx(data.pricePaid)}`;
      case "Conference Booking":
        return `${data.organizerName ?? "An organizer"} booked ${data.room ?? "a room"} for ${
          data.durationHours ?? "?"
        }h @ UGX ${ugx(data.price)}`;
      case "Expense Entry":
        return `${data.department ?? "A department"} spent UGX ${ugx(data.amount)} on ${
          data.description ?? "an expense"
        }`;
      default:
        return "New activity";
    }
  };

  // Load logged-in user's display name (auth state comes from AuthProvider).
  useEffect(() => {
    if (!user) {
      setUserName("Guest");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const userDoc = await getDoc(doc(db, COLLECTIONS.USERS, user.uid));
        if (cancelled) return;
        if (userDoc.exists()) {
          const data = userDoc.data();
          setUserName(data.name || data.email?.split("@")[0] || "User");
        } else {
          setUserName(user.displayName || user.email?.split("@")[0] || "User");
        }
      } catch {
        if (!cancelled) {
          setUserName(user.displayName || user.email?.split("@")[0] || "User");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Load notification sound
  useEffect(() => {
    notifSound.current = new Audio("/notification.mp3");
    notifSound.current.volume = 0.6;
  }, []);

  // Firestore listeners (scoped to this user's hotel)
  useEffect(() => {
    if (!hotelId) return;

    const sources = [
      { col: COLLECTIONS.RESTAURANT, label: "Restaurant Order" },
      { col: COLLECTIONS.BOOKINGS, label: "Room Booking" },
      { col: COLLECTIONS.CONFERENCE, label: "Conference Booking" },
      { col: COLLECTIONS.EXPENSES, label: "Expense Entry" },
    ];

    const unsubscribers = sources.map((src) => {
      // Skip the very first snapshot: Firestore reports every existing
      // document as "added" on load, which would otherwise spam a toast +
      // sound for all historical records each time the dashboard mounts.
      let initialized = false;
      return onSnapshot(hotelCollection(hotelId, src.col), (snap) => {
        if (!initialized) {
          initialized = true;
          return;
        }
        snap
          .docChanges()
          .filter((c) => c.type === "added")
          .forEach((change) => {
            const data = change.doc.data();

            const newItem: NotificationItem = {
              id: change.doc.id,
              type: src.label as NotificationItem["type"],
              timestamp: new Date(),
              data,
              summary: generateSummary(src.label as NotificationItem["type"], data),
            };

            setNotifications((prev) => [newItem, ...prev]);
            setUnreadCount((prev) => prev + 1);

            notifSound.current?.play().catch(() => {});

            setToasts((prev) => [
              ...prev,
              {
                id: newItem.id,
                message: newItem.summary!,
                type: newItem.type,
              },
            ]);

            setTimeout(() => {
              setToasts((prev) => prev.filter((t) => t.id !== newItem.id));
            }, 4500);
          });
      });
    });

    return () => unsubscribers.forEach((u) => u());
  }, [hotelId]);

  // Close notif dropdown when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        notifRef.current &&
        !notifRef.current.contains(t) &&
        notifBtnRef.current &&
        !notifBtnRef.current.contains(t)
      ) {
        setNotifOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const markAllAsRead = () => setUnreadCount(0);

  const handleNotifButton = () => {
    const willOpen = !notifOpen;
    setNotifOpen(willOpen);
    if (willOpen) markAllAsRead();
  };

  const handleLogout = async () => {
    await auth.signOut();
    navigate("/login", { replace: true });
  };

  const meta = pageMeta[location.pathname] ?? {
    title: "Dashboard",
    subtitle: "",
  };

  return (
    <div className="flex h-screen w-screen font-poppins overflow-hidden" style={{ background: "var(--app-bg)" }}>
      {/* DESKTOP SIDEBAR */}
      <motion.aside
        animate={{ width: collapsed ? sidebarWidthCollapsed : sidebarWidthExpanded }}
        transition={{ type: "spring", stiffness: 260, damping: 30 }}
        className="hidden md:flex flex-col fixed h-full z-30"
        style={{ background: "var(--rail)", borderRight: "1px solid var(--rail-border)" }}
      >
        <SidebarContent
          collapsed={collapsed}
          groups={groups}
          consoleLabel={consoleLabel}
          userName={userName}
          onLogout={handleLogout}
          onToggleCollapse={() => setCollapsed(!collapsed)}
          showCollapseBtn
        />
      </motion.aside>

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
              <SidebarContent
                collapsed={false}
                groups={groups}
                consoleLabel={consoleLabel}
                userName={userName}
                onNavigate={() => setMobileOpen(false)}
                onLogout={handleLogout}
              />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* MAIN CONTENT */}
      <div
        className="flex flex-col flex-1 min-h-0 min-w-0 ml-0 md:ml-[var(--rail-offset)] transition-all duration-300"
        style={{ "--rail-offset": `${collapsed ? sidebarWidthCollapsed : sidebarWidthExpanded}px` } as React.CSSProperties}
      >
          {/* HEADER */}
          <header
            className="flex items-center justify-between gap-4 px-4 sm:px-6 h-16 sticky top-0 z-20 bg-white/85 backdrop-blur-md"
            style={{ borderBottom: "1px solid var(--border)" }}
          >
            <div className="flex items-center gap-3 min-w-0">
              <button
                className="md:hidden p-2 rounded-lg hover:bg-slate-100 transition text-slate-600"
                onClick={() => setMobileOpen(true)}
                aria-label="Open navigation"
              >
                <Menu size={20} />
              </button>

              <div className="min-w-0 hidden sm:block">
                <h1 className="text-[15px] font-semibold text-slate-800 truncate leading-tight">
                  {meta.title}
                </h1>
                <p className="text-xs text-slate-400 truncate">{meta.subtitle}</p>
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-3">
              <WebMCPStatusBadge />
              <div className="hidden sm:flex items-center bg-slate-50 px-3 h-9 rounded-lg border border-slate-200">
                <Search size={16} className="text-slate-400" />
                <input
                  type="text"
                  aria-label="Search"
                  placeholder="Search…"
                  className="ml-2 bg-transparent outline-none text-sm w-40 lg:w-56 text-slate-700 placeholder-slate-400"
                />
              </div>

              {/* Notifications */}
              <div className="relative" ref={notifRef}>
                <button
                  ref={notifBtnRef}
                  onClick={handleNotifButton}
                  className="relative p-2 rounded-lg hover:bg-slate-100 transition text-slate-600"
                  aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ""}`}
                >
                  <Bell size={20} />
                  {unreadCount > 0 && (
                    <>
                      <span className="absolute -top-0.5 -right-0.5 bg-rose-500 text-white text-[10px] font-bold h-4 min-w-4 px-1 rounded-full flex items-center justify-center">
                        {unreadCount}
                      </span>
                      <span className="absolute top-0 right-0 h-3 w-3 rounded-full bg-rose-400 opacity-75 animate-ping" />
                    </>
                  )}
                </button>

                {notifOpen && (
                  <div className="absolute right-0 mt-3 w-80 bg-white shadow-lg rounded-xl z-50 border border-slate-200 overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                      <h3 className="text-sm font-semibold text-slate-800">
                        Recent Activity
                      </h3>
                      {notifications.length > 0 && (
                        <button
                          onClick={markAllAsRead}
                          className="text-xs font-medium text-blue-600 hover:text-blue-700 transition"
                        >
                          Mark all as read
                        </button>
                      )}
                    </div>

                    <div className="max-h-96 overflow-y-auto">
                      {notifications.length === 0 ? (
                        <div className="empty-state" style={{ padding: "36px 24px" }}>
                          <div className="empty-icon"><Bell size={22} /></div>
                          <p className="empty-title">No activity yet</p>
                          <p className="empty-desc">New bookings, orders and expenses will appear here in real time.</p>
                        </div>
                      ) : (
                        notifications.map((n) => (
                          <div
                            key={n.id}
                            className="flex items-start gap-3 px-4 py-3 hover:bg-slate-50 border-b border-slate-100 last:border-b-0 transition"
                          >
                            <div
                              className={`w-1 self-stretch rounded-full ${
                                n.type === "Restaurant Order"
                                  ? "bg-orange-500"
                                  : n.type === "Room Booking"
                                  ? "bg-blue-500"
                                  : n.type === "Conference Booking"
                                  ? "bg-purple-500"
                                  : "bg-green-500"
                              }`}
                            />
                            <div className="pt-0.5 shrink-0">{icons[n.type]}</div>
                            <div className="flex-1 min-w-0">
                              <div className="flex justify-between items-start">
                                <p className="text-sm font-medium text-slate-800 truncate">
                                  {n.type}
                                </p>
                                <span className="text-[10px] text-slate-400 ml-2 whitespace-nowrap">
                                  {n.timestamp.toLocaleTimeString([], {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}
                                </span>
                              </div>
                              <p className="text-xs text-slate-500 mt-0.5 truncate">
                                {n.summary}
                              </p>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="w-px h-6 bg-slate-200 hidden sm:block" />
              <ProfileMenu userName={userName} />
            </div>
          </header>

          {/* ROUTED MODULE */}
          <main className="flex-1 min-h-0 overflow-auto">
            <div className="mx-auto w-full max-w-[1400px] px-4 sm:px-6 py-6">
              <Outlet />
            </div>

            <footer className="px-6 py-4 border-t border-slate-200 text-xs text-slate-400 text-center">
              © {new Date().getFullYear()} InnPilot · Built by Masai Labs
            </footer>
          </main>
      </div>

      {/* SLIDE-DOWN TOASTS */}
      <div className="fixed top-4 right-4 z-[9999] space-y-2">
        <AnimatePresence>
          {toasts.map((toast) => (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.25 }}
              className="px-4 py-3 rounded-lg shadow-md bg-white border border-slate-200 text-sm flex items-center gap-3 max-w-sm"
            >
              {icons[toast.type]}
              <span className="font-medium text-slate-800">{toast.message}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default DashboardShell;
