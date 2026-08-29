import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { motion } from "framer-motion";
import CountUp from "react-countup";
import {
  BedDouble,
  Utensils,
  Briefcase,
  Wallet,
  TrendingUp,
  Scale,
  DoorOpen,
  Clock,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Legend,
} from "recharts";
import { onSnapshot } from "firebase/firestore";
import { COLLECTIONS } from "./lib/collections";
import { hotelCollection } from "./lib/hotelScope";
import { useAuth } from "./auth/AuthProvider";
import {
  computeMetrics,
  dailySeries,
  getRange,
  type DatePreset,
  type MetricsInput,
} from "./lib/metrics";

const PRESETS: { key: DatePreset; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "week", label: "This Week" },
  { key: "month", label: "This Month" },
  { key: "lastMonth", label: "Last Month" },
  { key: "all", label: "All Time" },
];

const ugx = (n: number) => `UGX ${n.toLocaleString()}`;

export default function OverviewDashboard() {
  const { hotelId } = useAuth();
  const [data, setData] = useState<MetricsInput>({
    bookings: [],
    orders: [],
    events: [],
    expenses: [],
    rooms: [],
  });
  const [preset, setPreset] = useState<DatePreset>("today");

  // Shared operational data: the overview aggregates the whole hotel.
  useEffect(() => {
    if (!hotelId) return;
    const subs = [
      onSnapshot(hotelCollection(hotelId, COLLECTIONS.BOOKINGS), (snap) =>
        setData((p) => ({ ...p, bookings: snap.docs.map((d) => d.data()) }))
      ),
      onSnapshot(hotelCollection(hotelId, COLLECTIONS.RESTAURANT), (snap) =>
        setData((p) => ({ ...p, orders: snap.docs.map((d) => d.data()) }))
      ),
      onSnapshot(hotelCollection(hotelId, COLLECTIONS.CONFERENCE), (snap) =>
        setData((p) => ({ ...p, events: snap.docs.map((d) => d.data()) }))
      ),
      onSnapshot(hotelCollection(hotelId, COLLECTIONS.EXPENSES), (snap) =>
        setData((p) => ({ ...p, expenses: snap.docs.map((d) => d.data()) }))
      ),
      onSnapshot(hotelCollection(hotelId, COLLECTIONS.ROOMS), (snap) =>
        setData((p) => ({ ...p, rooms: snap.docs.map((d) => d.data()) }))
      ),
    ];
    return () => subs.forEach((u) => u());
  }, [hotelId]);

  const range = useMemo(() => getRange(preset), [preset]);
  const metrics = useMemo(() => computeMetrics(data, range), [data, range]);
  const trend = useMemo(() => dailySeries(data, range), [data, range]);

  const departmentData = [
    { name: "Accommodation", revenue: metrics.accommodationRevenue },
    { name: "Restaurant", revenue: metrics.restaurantRevenue },
    { name: "Conference", revenue: metrics.conferenceRevenue },
  ];

  const primaryCards: {
    title: string;
    value: number;
    prefix?: string;
    suffix?: string;
    icon: ReactNode;
    tone: string;
    note?: string;
  }[] = [
    {
      title: `Revenue (${range.label})`,
      value: metrics.totalRevenue,
      prefix: "UGX ",
      icon: <TrendingUp size={19} />,
      tone: "is-success",
    },
    {
      title: `Expenses (${range.label})`,
      value: metrics.totalExpenses,
      prefix: "UGX ",
      icon: <Wallet size={19} />,
      tone: "is-warning",
    },
    {
      // Not "Profit": only reflects revenue and expenses recorded here.
      title: "Net Operating Result",
      value: metrics.netOperatingResult,
      prefix: "UGX ",
      icon: <Scale size={19} />,
      tone: metrics.netOperatingResult >= 0 ? "is-success" : "is-warning",
    },
    {
      title: "Occupancy",
      value: metrics.occupancy.rate ?? 0,
      suffix: metrics.occupancy.rate === null ? "" : "%",
      icon: <DoorOpen size={19} />,
      tone: "is-purple",
      note:
        metrics.occupancy.rate === null
          ? "Register rooms to track occupancy"
          : `${metrics.occupancy.occupied} of ${metrics.occupancy.totalRooms} rooms occupied`,
    },
  ];

  const departmentCards = [
    {
      title: "Accommodation",
      value: metrics.accommodationRevenue,
      count: `${metrics.bookingsCount} booking${metrics.bookingsCount === 1 ? "" : "s"}`,
      icon: <BedDouble size={19} />,
      tone: "is-purple",
    },
    {
      title: "Restaurant",
      value: metrics.restaurantRevenue,
      count: `${metrics.ordersCount} order${metrics.ordersCount === 1 ? "" : "s"}`,
      icon: <Utensils size={19} />,
      tone: "is-orange",
    },
    {
      title: "Conference",
      value: metrics.conferenceRevenue,
      count: `${metrics.eventsCount} event${metrics.eventsCount === 1 ? "" : "s"}`,
      icon: <Briefcase size={19} />,
      tone: "is-success",
    },
    {
      title: "Pending Payments",
      value: metrics.pendingPayments.amount,
      count: `${metrics.pendingPayments.count} booking${metrics.pendingPayments.count === 1 ? "" : "s"} unpaid`,
      icon: <Clock size={19} />,
      tone: "is-warning",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header + date range switcher */}
      <div className="page-header">
        <div>
          <h2 className="page-title">Overview</h2>
          <p className="page-subtitle">
            Hotel-wide performance · {range.label.toLowerCase()}
          </p>
        </div>
        <div className="flex rounded-lg border border-slate-200 bg-white p-1 gap-1" role="tablist" aria-label="Date range">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              role="tab"
              aria-selected={preset === p.key}
              onClick={() => setPreset(p.key)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${
                preset === p.key
                  ? "bg-blue-600 text-white"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Primary KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {primaryCards.map((item, idx) => (
          <motion.div
            key={item.title}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: idx * 0.05 }}
            className="stat-card"
          >
            <div className="stat-top">
              <span className="stat-label">{item.title}</span>
              <span className={`stat-icon ${item.tone}`}>{item.icon}</span>
            </div>
            <div className="stat-value">
              <CountUp
                start={0}
                end={item.value}
                duration={1.2}
                separator=","
                prefix={item.prefix || ""}
                suffix={item.suffix || ""}
              />
            </div>
            {item.note && <p className="text-xs muted mt-1">{item.note}</p>}
          </motion.div>
        ))}
      </div>

      {/* Department cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {departmentCards.map((item, idx) => (
          <motion.div
            key={item.title}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.2 + idx * 0.05 }}
            className="stat-card"
          >
            <div className="stat-top">
              <span className="stat-label">{item.title}</span>
              <span className={`stat-icon ${item.tone}`}>{item.icon}</span>
            </div>
            <div className="stat-value" style={{ fontSize: 20 }}>
              {ugx(item.value)}
            </div>
            <p className="text-xs muted mt-1">{item.count}</p>
          </motion.div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Revenue vs Expenses */}
        <div className="card card-pad">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp size={18} className="text-blue-600" />
            <span className="section-title">Revenue vs Expenses</span>
            <span className="text-xs muted ml-auto">{range.label}</span>
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={trend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef1f4" vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "#e5e8ee" }} />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={64}
                tickFormatter={(v) => Number(v).toLocaleString()}
              />
              <Tooltip formatter={(v: any) => ugx(Number(v))} />
              <Legend />
              <Line
                type="monotone"
                name="Revenue"
                dataKey="revenue"
                stroke="#16a34a"
                strokeWidth={2.5}
                dot={{ r: 3, fill: "#16a34a" }}
                activeDot={{ r: 5 }}
              />
              <Line
                type="monotone"
                name="Expenses"
                dataKey="expenses"
                stroke="#dc2626"
                strokeWidth={2.5}
                dot={{ r: 3, fill: "#dc2626" }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Revenue by department */}
        <div className="card card-pad">
          <div className="flex items-center gap-2 mb-4">
            <Briefcase size={18} className="text-purple-600" />
            <span className="section-title">Revenue by Department</span>
            <span className="text-xs muted ml-auto">{range.label}</span>
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={departmentData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef1f4" vertical={false} />
              <XAxis dataKey="name" tickLine={false} axisLine={{ stroke: "#e5e8ee" }} />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={64}
                tickFormatter={(v) => Number(v).toLocaleString()}
              />
              <Tooltip formatter={(v: any) => ugx(Number(v))} />
              <Bar dataKey="revenue" name="Revenue" fill="#2563eb" radius={[4, 4, 0, 0]} maxBarSize={56} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
