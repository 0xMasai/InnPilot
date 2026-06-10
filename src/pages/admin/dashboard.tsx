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
import { motion } from "framer-motion";
import Tippy from "@tippyjs/react";
import "tippy.js/dist/tippy.css";

import ExpensesDashboard from "./Expenses";
import ConferenceDashboard from "../admin/Conference";
import RestaurantDashboard from "../admin/Restaurant";
import AccommodationDashboard from "../admin/Accommodation";
import OverviewDashboard from "../admin/Overview";

import { auth, db } from "../../../firebase";
import {
  onAuthStateChanged,
  type User as FirebaseUser,
} from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";

import { useNavigate } from "react-router-dom";

interface DashboardProps {
  children?: ReactNode;
}

const menuItems = [
  { icon: <LayoutDashboard size={20} />, label: "Overview" },
  { icon: <BedDouble size={20} />, label: "Accommodation" },
  { icon: <Utensils size={20} />, label: "Restaurant" },
  { icon: <Briefcase size={20} />, label: "Conference" },
  { icon: <PieChart size={20} />, label: "Expenses" },
];

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

      navigate("/admin/login", { replace: true });

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
        <img
          src="https://randomuser.me/api/portraits/men/32.jpg"
          alt="avatar"
          className="w-8 h-8 rounded-full mr-2"
        />
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

  const navigate = useNavigate(); // ✅ FIXED — added missing navigate()

  const sidebarWidthExpanded = 288;
  const sidebarWidthCollapsed = 84;

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(
      auth,
      async (user: FirebaseUser | null) => {
        if (user) {
          try {
            const userDoc = await getDoc(doc(db, "users", user.uid));
            if (userDoc.exists()) {
              const data = userDoc.data();
              setUserName(data.name || data.email.split("@")[0] || "User");
            } else {
              setUserName(
                user.displayName || user.email?.split("@")[0] || "User"
              );
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

  return (
    <div className="flex h-screen w-screen font-poppins bg-slate-50 overflow-hidden">
      
      {/* SIDEBAR */}
      <motion.aside
        animate={{
          width: collapsed ? sidebarWidthCollapsed : sidebarWidthExpanded,
        }}
        transition={{ type: "spring", stiffness: 200, damping: 25 }}
        className="hidden md:flex bg-[#0A122A] text-white flex-col fixed h-full z-30 border-r border-white/10"
      >
        {/* LOGO */}
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          {!collapsed && (
            <div className="flex items-center gap-3">
              <Shield className="size-7 text-blue-400" />
              <h2 className="text-xl font-semibold">Admin Panel</h2>
            </div>
          )}

          <button
            onClick={() => setCollapsed(!collapsed)}
            className="p-2 rounded-lg hover:bg-white/10 transition"
          >
            <Menu size={20} className="text-gray-300" />
          </button>
        </div>

        {/* MENU LIST */}
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
                <span
                  className={`${
                    activeIndex === i ? "text-white" : "text-gray-400"
                  }`}
                >
                  {item.icon}
                </span>

                {!collapsed && (
                  <span className="text-[16px] font-medium">{item.label}</span>
                )}
              </button>
            </Tippy>
          ))}
        </nav>

        {/* FOOTER / QUICK LOGOUT */}
        <div className="p-4 border-t border-white/10">
          <button
            onClick={async () => {
              await auth.signOut();
              navigate("/admin/login", { replace: true });
            }}
            className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/5 hover:bg-white/10 transition text-gray-200 w-full"
          >
            <img
              src="https://randomuser.me/api/portraits/men/32.jpg"
              alt="user"
              className="w-9 h-9 rounded-full"
            />

            {!collapsed && (
              <div className="flex-1">
                <div className="text-sm font-semibold">{userName}</div>
                <div className="text-xs text-gray-400">Admin</div>
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
            <button className="relative p-2 rounded-full hover:bg-gray-100 transition">
              <Bell size={20} className="text-gray-600" />
              <span className="absolute top-0 right-0 h-2 w-2 bg-rose-500 rounded-full"></span>
            </button>

            <ProfileMenu userName={userName} />
          </div>
        </header>

        {/* SWITCH BETWEEN PAGES */}
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
    </div>
  );
};

export default HybridDashboard;
