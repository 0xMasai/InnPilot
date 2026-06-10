import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import CountUp from "react-countup";
import { BedDouble, Utensils, PieChart, DollarSign } from "lucide-react";
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
import {
  collection,
  onSnapshot,
  query,
  where,
  Timestamp
} from "firebase/firestore";
import { db, auth } from "../firebase";

interface DailyData {
  day: string;
  expenses?: number;
  meals?: number;
  bookings?: number;
}

export default function OverviewDashboard() {
  const [summary, setSummary] = useState({
    totalExpenses: 0,
    totalMeals: 0,
    totalBookings: 0,
  });

  const [expensesData, setExpensesData] = useState<DailyData[]>([]);
  const [mealsData, setMealsData] = useState<DailyData[]>([]);
  const [bookingsData, setBookingsData] = useState<DailyData[]>([]);

  // Convert Firestore timestamp or strings safely
  const toDateSafe = (ts: any) => {
    if (!ts) return null;
    if (ts instanceof Timestamp) return ts.toDate();
    const d = new Date(ts);
    return isNaN(d.getTime()) ? null : d;
  };

  useEffect(() => {
    const user = auth.currentUser;
    if (!user) return;
    const userId = user.uid;

    const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

    const expensesTrend: DailyData[] = weekdays.map((d) => ({ day: d, expenses: 0 }));
    const mealsTrend: DailyData[] = weekdays.map((d) => ({ day: d, meals: 0 }));
    const bookingsTrend: DailyData[] = weekdays.map((d) => ({ day: d, bookings: 0 }));

    // --- EXPENSES REAL-TIME ---
    const unsubscribeExpenses = onSnapshot(
      query(collection(db, "expenses"), where("userId", "==", userId)),
      (snap) => {
        let totalExpenses = 0;

        snap.forEach((doc) => {
          const data = doc.data();
          const amount = Number(data.amount || 0);
          totalExpenses += amount;

          const dt = toDateSafe(data.timestamp);
          if (!dt) return;

          const index = (dt.getDay() + 6) % 7;
          expensesTrend[index].expenses! += amount;
        });

        setSummary((s) => ({ ...s, totalExpenses }));
        setExpensesData([...expensesTrend]);
      }
    );

    // --- MEALS REAL-TIME ---
    const unsubscribeMeals = onSnapshot(
      query(collection(db, "restaurant"), where("userId", "==", userId)),
      (snap) => {
        let totalMeals = snap.size;

        snap.forEach((doc) => {
          const dt = toDateSafe(doc.data().timestamp);
          if (!dt) return;

          const index = (dt.getDay() + 6) % 7;
          mealsTrend[index].meals! += 1;
        });

        setSummary((s) => ({ ...s, totalMeals }));
        setMealsData([...mealsTrend]);
      }
    );

    // --- ACCOMMODATION REAL-TIME ---
    const unsubscribeAccommodation = onSnapshot(
      query(collection(db, "accomodation"), where("userId", "==", userId)),
      (snap) => {
        let totalBookings = snap.size;

        snap.forEach((doc) => {
          const dt = toDateSafe(doc.data().checkIn);
          if (!dt) return;

          const index = (dt.getDay() + 6) % 7;
          bookingsTrend[index].bookings! += 1;
        });

        setSummary((s) => ({ ...s, totalBookings }));
        setBookingsData([...bookingsTrend]);
      }
    );

    return () => {
      unsubscribeExpenses();
      unsubscribeMeals();
      unsubscribeAccommodation();
    };
  }, []);

  // --- KPI CARDS ---
  const summaryCards = [
    {
      title: "Total Expenses",
      value: summary.totalExpenses,
      prefix: "UGX ",
      icon: <DollarSign size={20} />,
      gradient: "from-sky-500 to-blue-600",
    },
    {
      title: "Total Meals",
      value: summary.totalMeals,
      icon: <Utensils size={20} />,
      gradient: "from-orange-500 to-yellow-500",
    },
    {
      title: "Total Bookings",
      value: summary.totalBookings,
      icon: <BedDouble size={20} />,
      gradient: "from-purple-500 to-indigo-600",
    },
  ];

  return (
    <div className="p-6 space-y-8">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h2 className="text-2xl sm:text-3xl font-bold text-gray-800 leading-snug">
          Overview
        </h2>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
        {summaryCards.map((item, idx) => (
          <motion.div key={idx} whileHover={{ scale: 1.05 }}>
            <div
              className={`bg-linear-to-r ${item.gradient} rounded-2xl p-5 shadow-lg text-white flex flex-col justify-between h-36`}
            >
              <div className="flex items-center gap-2 text-sm font-medium">
                {item.icon}
                <span>{item.title}</span>
              </div>
              <div className="text-3xl font-bold">
                <CountUp
                  start={0}
                  end={item.value}
                  duration={1.5}
                  separator=","
                  prefix={item.prefix || ""}
                />
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Expenses */}
        <div className="lg:col-span-3 bg-white rounded-2xl shadow-md p-5">
          <div className="flex items-center gap-2 mb-3">
            <PieChart size={20} className="text-blue-600" />
            <span className="font-semibold text-gray-700">Expense Trend (Last 7 Days)</span>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={expensesData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="day" />
              <YAxis />
              <Tooltip />
              <Line
                type="monotone"
                dataKey="expenses"
                stroke="#2563eb"
                strokeWidth={3}
                dot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Meals */}
        <div className="bg-white rounded-2xl shadow-md p-5">
          <div className="flex items-center gap-2 mb-3">
            <Utensils size={20} className="text-orange-500" />
            <span className="font-semibold text-gray-700">Meals Served (Last 7 Days)</span>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={mealsData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="day" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="meals" fill="#f97316" radius={[5, 5, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Bookings */}
        <div className="bg-white rounded-2xl shadow-md p-5">
          <div className="flex items-center gap-2 mb-3">
            <BedDouble size={20} className="text-purple-600" />
            <span className="font-semibold text-gray-700">Room Bookings (Last 7 Days)</span>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={bookingsData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="day" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="bookings" fill="#a855f7" radius={[5, 5, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
