// HybridDashboard.tsx
import { useState, useEffect, useRef, type ReactNode } from "react";
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
  Shield,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion"; // ⭐ NEW
import Tippy from "@tippyjs/react";
import "tippy.js/dist/tippy.css";
import AccountCircleIcon from "@mui/icons-material/AccountCircle";

import ExpensesDashboard from "./Expenses";
import ConferenceDashboard from "./Conference";
import RestaurantDashboard from "./Restaurant";
import AccommodationDashboard from "./Accommodation";
import OverviewDashboard from "./Overview";

import { auth, db } from "../firebase";
import {
  onAuthStateChanged,
  type User as FirebaseUser,
} from "firebase/auth";
import { doc, getDoc, collection, onSnapshot } from "firebase/firestore";

import { useNavigate } from "react-router-dom";

interface DashboardProps {
  children?: ReactNode;
}

type NotificationItem = {
  id: string;
  type:
    | "Restaurant Order"
    | "Room Booking"
    | "Conference Booking"
    | "Expense Entry";
  timestamp: Date;
  data: Record<string, any>;
  summary?: string; // ⭐ NEW
};

// Toast type
type ToastItem = {
  id: string;
  message: string;
  type: NotificationItem["type"];
};

const menuItems = [
  { icon: <LayoutDashboard size={20} />, label: "Overview" },
  { icon: <BedDouble size={20} />, label: "Accommodation" },
  { icon: <Utensils size={20} />, label: "Restaurant" },
  { icon: <Briefcase size={20} />, label: "Conference" },
  { icon: <PieChart size={20} />, label: "Expenses" },
];

// PROFILE MENU (unchanged)
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

      window.history.pushState(null, "", window.location.href);
      window.onpopstate = () => window.history.go(1);
    } catch (err) {
      console.error("Error logging out:", err);
    }
  };

  return (
    <div className="relative" ref={ref}>
      <div
        className="flex items-center p-2 rounded-xl hover:bg-gray-100 transition cursor-pointer"
        onClick={() => setOpen(!open)}
      >
        <AccountCircleIcon className="w-8 h-8 mr-2 text-gray-600" />
        <span className="hidden sm:block text-sm font-medium text-gray-700">
          {userName}
        </span>
      </div>

      {open && (
        <div className="absolute right-0 mt-2 w-48 bg-white border border-gray-200 rounded-xl shadow-lg z-50">
          {/* <button
            onClick={() => {
              setOpen(false);
              navigate("/profile");
            }}
            className="flex items-center w-full px-4 py-2 hover:bg-gray-100 rounded-t-xl transition"
          >
            <User size={18} className="mr-2 text-gray-600" />
            Profile
          </button> */}

          <button
            onClick={handleLogout}
            className="flex items-center w-full px-4 py-2 hover:bg-gray-100 rounded-b-xl transition text-red-600"
          >
            <LogOut size={18} className="mr-2" />
            Logout
          </button>
        </div>
      )}
    </div>
  );
};

// MAIN DASHBOARD
const HybridDashboard: React.FC<DashboardProps> = () => {
  const [collapsed, setCollapsed] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [userName, setUserName] = useState("Loading...");
  const navigate = useNavigate();

  const sidebarWidthExpanded = 288;
  const sidebarWidthCollapsed = 84;

  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const notifRef = useRef<HTMLDivElement | null>(null);
  const notifBtnRef = useRef<HTMLButtonElement | null>(null);
  const notifSound = useRef<HTMLAudioElement | null>(null);

  // ⭐ NEW — Toast notifications
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const icons: Record<NotificationItem["type"], React.ReactNode> = {
    "Restaurant Order": <Utensils size={16} className="text-orange-500" />,
    "Room Booking": <BedDouble size={16} className="text-blue-500" />,
    "Conference Booking": <Briefcase size={16} className="text-purple-500" />,
    "Expense Entry": <PieChart size={16} className="text-green-600" />,
  };

  // Convert Firestore data into readable summary ⭐ NEW
  const generateSummary = (type: NotificationItem["type"], data: any) => {
    switch (type) {
      case "Restaurant Order":
        return `${data.client} ordered ${data.category} @ UGX ${data.price}`;
      case "Room Booking":
        return `${data.guest} booked ${data.room} (${data.type}) @ UGX ${data.amount}`;
      case "Conference Booking":
        return `${data.organizer} booked ${data.room} for ${data.duration} @ UGX ${data.price}`;
      case "Expense Entry":
        return `${data.department} spent UGX ${data.amount} on ${data.description}`;
      default:
        return "New activity";
    }
  };

  // Load logged-in user name
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(
      auth,
      async (user: FirebaseUser | null) => {
        if (user) {
          try {
            const userDoc = await getDoc(doc(db, "users", user.uid));
            if (userDoc.exists()) {
              const data = userDoc.data();
              setUserName(data.name || data.email?.split("@")[0] || "User");
            } else {
              setUserName(user.displayName || user.email?.split("@")[0] || "User");
            }
          } catch (err) {
            console.error("Error fetching user data:", err);
            setUserName(user.displayName || user.email?.split("@")[0] || "User");
          }
        } else {
          setUserName("Guest");
        }
      }
    );
    return () => unsubscribe();
  }, []);

  // Load notification sound
  useEffect(() => {
    notifSound.current = new Audio("/notification.mp3");
    notifSound.current.volume = 0.6;
  }, []);

  // Firestore listeners
  useEffect(() => {
    const sources = [
      { col: "restaurant", label: "Restaurant Order" },
      { col: "accommodation", label: "Room Booking" }, // ⭐ FIX spelling
      { col: "conferenceRooms", label: "Conference Booking" },
      { col: "expenses", label: "Expense Entry" },
    ];

    const unsubscribers = sources.map((src) =>
      onSnapshot(collection(db, src.col), (snap) => {
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
              summary: generateSummary(src.label as any, data), // ⭐ NEW
            };

            setNotifications((prev) => [newItem, ...prev]);
            setUnreadCount((prev) => prev + 1);

            // play sound
            notifSound.current?.play().catch(() => {});

            // ⭐ Show animated toast
            setToasts((prev) => [
              ...prev,
              {
                id: newItem.id,
                message: newItem.summary!,
                type: newItem.type,
              },
            ]);

            // Auto-remove toast
            setTimeout(() => {
              setToasts((prev) => prev.filter((t) => t.id !== newItem.id));
            }, 4500);
          });
      })
    );

    return () => unsubscribers.forEach((u) => u());
  }, []);

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

  return (
    <div className="flex h-screen w-screen font-poppins bg-slate-50 overflow-hidden">
      {/* SIDEBAR (unchanged except cosmetics) */}
      <motion.aside
        animate={{
          width: collapsed ? sidebarWidthCollapsed : sidebarWidthExpanded,
        }}
        transition={{ type: "spring", stiffness: 200, damping: 25 }}
        className="hidden md:flex bg-[#0A122A] text-white flex-col fixed h-full z-30 border-r border-white/10"
      >
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          {!collapsed && (
            <div className="flex items-center gap-3">
              <Shield className="size-7 text-blue-400" />
              <h2 className="text-xl font-semibold">Staff Panel</h2>
            </div>
          )}

          <button
            onClick={() => setCollapsed(!collapsed)}
            className="p-2 rounded-lg hover:bg-white/10 transition"
          >
            <Menu size={20} className="text-gray-300" />
          </button>
        </div>

        <nav className="flex-1 px-3 mt-4 space-y-1">
          {menuItems.map((item, i) => (
            <Tippy key={i} content={collapsed ? item.label : ""} placement="right">
              <button
                onClick={() => setActiveIndex(i)}
                className={`flex items-center w-full px-4 py-3 rounded-xl transition-all
                  ${
                    activeIndex === i
                      ? "bg-white/10 text-white shadow-sm"
                      : "text-gray-300 hover:bg-white/10 hover:text-white"
                  }
                  ${collapsed ? "justify-center" : "gap-3"}
                `}
              >
                {item.icon}
                {!collapsed && (
                  <span className="text-[16px] font-medium">{item.label}</span>
                )}
              </button>
            </Tippy>
          ))}
        </nav>

        {/* Footer quick logout */}
        <div className="p-4 border-t border-white/10">
          <button
            onClick={async () => {
              await auth.signOut();
              navigate("/login", { replace: true });
            }}
            className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/5 hover:bg-white/10 transition text-gray-200 w-full"
          >
            <AccountCircleIcon className="w-8 h-8 mr-2 text-gray-600" />

            {!collapsed && (
              <div className="flex-1">
                <div className="text-sm font-semibold">{userName}</div>
                <div className="text-xs text-gray-400">User</div>
              </div>
            )}

            <LogOut size={18} className="text-gray-400" />
          </button>
        </div>
      </motion.aside>

      {/* MAIN CONTENT */}
      <div
        className="flex-1 flex flex-col overflow-auto transition-all duration-300"
        style={{
          marginLeft: collapsed ? sidebarWidthCollapsed : sidebarWidthExpanded,
        }}
      >
        {/* HEADER */}
        <header className="flex items-center justify-between p-4 bg-white shadow-md border-b border-gray-200 sticky top-0 z-20 backdrop-blur-md bg-opacity-80">
          <div className="flex items-center gap-3">
            <button className="md:hidden p-2 rounded-md hover:bg-gray-100 transition">
              <Menu size={20} />
            </button>

            <div className="flex items-center bg-gray-50 px-3 py-2 rounded-lg border border-gray-200 shadow-sm">
              <Search size={16} className="text-gray-400" />
              <input
                type="text"
                placeholder="Search..."
                className="ml-2 bg-transparent outline-none text-sm w-48 sm:w-64"
              />
            </div>
          </div>

          <div className="flex items-center space-x-4">
            {/* Notifications */}
            <div className="relative" ref={notifRef}>
              <button
                ref={notifBtnRef}
                onClick={handleNotifButton}
                className="relative p-2 rounded-full hover:bg-gray-100 transition"
              >
                <Bell size={20} className="text-gray-600" />

                {unreadCount > 0 && (
                  <>
                    <span className="absolute -top-1 -right-1 bg-rose-500 text-white text-[10px] font-bold h-4 w-4 rounded-full flex items-center justify-center">
                      {unreadCount}
                    </span>

                    <span className="absolute -top-2 -right-2 h-3 w-3 rounded-full bg-rose-400 opacity-75 animate-ping" />
                  </>
                )}
              </button>

              {notifOpen && (
                <div className="absolute right-0 mt-3 w-80 bg-white shadow-2xl rounded-2xl z-50 border border-gray-200">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
                    <h3 className="text-sm font-semibold text-gray-800">
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
                      <p className="text-gray-500 text-sm text-center py-8">
                        No activity yet
                      </p>
                    ) : (
                      notifications.map((n) => (
                        <div
                          key={n.id}
                          className="flex items-start gap-3 px-4 py-3 hover:bg-gray-50 border-b last:border-b-0 transition rounded-lg bg-white"
                        >
                          <div
                            className={`w-1 rounded-full mt-1 ${
                              n.type === "Restaurant Order"
                                ? "bg-orange-500"
                                : n.type === "Room Booking"
                                ? "bg-blue-500"
                                : n.type === "Conference Booking"
                                ? "bg-purple-500"
                                : "bg-green-500"
                            }`}
                          />
                          <div className="pt-1 shrink-0">{icons[n.type]}</div>

                          <div className="flex-1 min-w-0">
                            <div className="flex justify-between items-start">
                              <p className="text-sm font-medium text-gray-800 truncate">
                                {n.type}
                              </p>
                              <span className="text-[10px] text-gray-400 ml-2 whitespace-nowrap">
                                {n.timestamp.toLocaleTimeString([], {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </span>
                            </div>

                            <p className="text-xs text-gray-600 mt-1 truncate">
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

            <ProfileMenu userName={userName} />
          </div>
        </header>

        {/* PAGE SWITCH */}
        <main className="flex-1 p-6 min-h-0 overflow-auto">
          {activeIndex === 0 && <OverviewDashboard />}
          {activeIndex === 1 && <AccommodationDashboard />}
          {activeIndex === 2 && <RestaurantDashboard />}
          {activeIndex === 3 && <ConferenceDashboard />}
          {activeIndex === 4 && <ExpensesDashboard />}
        </main>

        {/* FOOTER */}
        <footer className="px-6 py-4 border-t border-gray-200 bg-white/70 text-xs text-gray-500 text-center">
          © {new Date().getFullYear()} Built with ❤️ by Masai Labs ✝️
        </footer>
      </div>

      {/* ⭐ NEW — SLIDE-DOWN TOASTS */}
      <div className="fixed top-4 right-4 z-9999 space-y-2">
        <AnimatePresence>
          {toasts.map((toast) => (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.25 }}
              className="px-4 py-3 rounded-lg shadow-lg bg-white border border-gray-200 text-sm flex items-center gap-3"
            >
              {icons[toast.type]}
              <span className="font-medium text-gray-800">{toast.message}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default HybridDashboard;
