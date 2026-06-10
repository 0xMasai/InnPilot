import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import CountUp from "react-countup";
import { BedDouble, Utensils, PieChart as PieIcon, DollarSign } from "lucide-react";
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
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { collection, onSnapshot, Timestamp } from "firebase/firestore";
import { db } from "../../../firebase";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";


interface DailyData {
  day: string;
  expenses?: number;
  meals?: number;
  bookings?: number;
}

interface Summary {
  totalExpenses: number;
  dailyExpenses: number;
  totalMeals: number;
  dailyMeals: number;
  occupiedRooms: number;
  freeRooms: number;
}

const BUSINESS_NAME = "Hotel Revenue Report";
const PDF_FILENAME = "revenue-report.pdf";
const CSV_FILENAME = "revenue-report.csv";


function formatUGX(amount: number) {
  return new Intl.NumberFormat("en-UG", {
    style: "currency",
    currency: "UGX",
    maximumFractionDigits: 0,
  }).format(Math.round(amount));
}

export default function OverviewDashboard() {
  const [summary, setSummary] = useState<Summary>({
    totalExpenses: 0,
    dailyExpenses: 0,
    totalMeals: 0,
    dailyMeals: 0,
    occupiedRooms: 0,
    freeRooms: 0,
  });

  const [expensesData, setExpensesData] = useState<DailyData[]>([]);
  const [mealsData, setMealsData] = useState<DailyData[]>([]);
  const [bookingsData, setBookingsData] = useState<DailyData[]>([]);

  const [restaurantRevenue, setRestaurantRevenue] = useState(0);
  const [accommodationRevenue, setAccommodationRevenue] = useState(0);
  const [conferenceRevenue, setConferenceRevenue] = useState(0);

  // Helper: last 7 days
  const getLast7Days = () => {
    const days: string[] = [];
    const labels: string[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      days.push(d.toISOString().slice(0, 10));
      labels.push(d.toLocaleDateString("en-US", { weekday: "short" }));
    }
    return { days, labels };
  };

  useEffect(() => {
    const { days, labels } = getLast7Days();

    const initTrend = <T extends keyof DailyData>(key: T) =>
      labels.map((day) => ({ day, [key]: 0 } as DailyData & Record<T, number>));

    // Expenses
    const unsubscribeExpenses = onSnapshot(collection(db, "expenses"), (snap) => {
      let totalExpenses = 0;
      let dailyExpenses = 0;
      const trend = initTrend("expenses");

      snap.forEach((doc) => {
        const data = doc.data();
        const amount = Number(data.amount) || 0;
        totalExpenses += amount;

        const ts: Timestamp | string = data.timestamp || data.date;
        const date = ts instanceof Timestamp ? ts.toDate() : new Date(ts);
        const isoDate = isNaN(date.getTime()) ? new Date().toISOString().slice(0, 10) : date.toISOString().slice(0, 10);

        if (days.includes(isoDate)) trend[days.indexOf(isoDate)].expenses! += amount;

        if (isoDate === new Date().toISOString().slice(0, 10)) dailyExpenses += amount;
      });

      setSummary((prev) => ({ ...prev, totalExpenses, dailyExpenses }));
      setExpensesData(trend);
    });

    // Meals / Restaurant
    const unsubscribeMeals = onSnapshot(collection(db, "restaurant"), (snap) => {
      let totalMeals = 0;
      let dailyMeals = 0;
      let totalRestaurantRevenue = 0;
      let dailyRestaurantRevenue = 0;

      const trend = initTrend("meals");

      snap.forEach((doc) => {
        const data = doc.data();
        const price = Number(data.price) || 0;
        totalMeals += 1;
        totalRestaurantRevenue += price;

        const ts: Timestamp | string = data.createdAt || data.timestamp;
        const date = ts instanceof Timestamp ? ts.toDate() : new Date(ts);
        const isoDate = isNaN(date.getTime()) ? new Date().toISOString().slice(0, 10) : date.toISOString().slice(0, 10);

        if (days.includes(isoDate)) trend[days.indexOf(isoDate)].meals! += 1;
        if (isoDate === new Date().toISOString().slice(0, 10)) {
          dailyMeals += 1;
          dailyRestaurantRevenue += price;
        }
      });

      setSummary((prev) => ({
        ...prev,
        totalMeals,
        dailyMeals,
      }));
      setMealsData(trend);
      setRestaurantRevenue(totalRestaurantRevenue);
    });

    // Accommodation / Bookings
   const unsubscribeRooms = onSnapshot(collection(db, "accomodation"), (snap) => {
    let occupiedRooms = 0;
    let freeRooms = 0;
    const trend = initTrend("bookings");
    let totalAccommodationRevenue = 0;

    snap.forEach((doc) => {
      const data = doc.data();

      // Occupied / free
      if (data.isOccupied || (data.paymentStatus || "").toLowerCase() === "paid") occupiedRooms++;
      else freeRooms++;

      // Booking trend
      const ts: Timestamp = data.checkIn;
      const date = ts.toDate();
      const isoDate = isNaN(date.getTime()) ? new Date().toISOString().slice(0, 10) : date.toISOString().slice(0, 10);

      if (days.includes(isoDate)) trend[days.indexOf(isoDate)].bookings! += 1;

      // Revenue
      totalAccommodationRevenue += Number(data.pricePaid) || 0;
    });

    setSummary((prev) => ({ ...prev, occupiedRooms, freeRooms }));
    setBookingsData(trend);
    setAccommodationRevenue(totalAccommodationRevenue);
  });


    // Conference Revenue
   const unsubscribeConference = onSnapshot(collection(db, "conferenceRooms"), (snap) => {
    let totalConferenceRevenue = 0;

    snap.forEach((doc) => {
      const data = doc.data();
      totalConferenceRevenue += Number(data.price) || 0;
    });

    setConferenceRevenue(totalConferenceRevenue);
  });


    return () => {
      unsubscribeExpenses();
      unsubscribeMeals();
      unsubscribeRooms();
      unsubscribeConference();
    };
  }, []);

  const totalRevenue = restaurantRevenue + accommodationRevenue + conferenceRevenue;
  const netProfit = totalRevenue - summary.totalExpenses;

  const summaryCards = [
    {
      title: "Total Expenses",
      valueNumeric: summary.totalExpenses,
      icon: <DollarSign size={20} />,
      gradient: "from-red-500 to-rose-600",
    },
    {
      title: "Restaurant Revenue",
      valueNumeric: restaurantRevenue,
      icon: <Utensils size={20} />,
      gradient: "from-orange-400 to-amber-500",
    },
    {
      title: "Accommodation Revenue",
      valueNumeric: accommodationRevenue,
      icon: <BedDouble size={20} />,
      gradient: "from-blue-500 to-cyan-500",
    },
    {
      title: "Conference Revenue",
      valueNumeric: conferenceRevenue,
      icon: <PieIcon size={20} />,
      gradient: "from-purple-500 to-pink-600",
    },
    {
      title: "Total Revenue",
      valueNumeric: totalRevenue,
      icon: <PieIcon size={20} />,
      gradient: "from-emerald-500 to-green-600",
    },
    {
      title: "Net Profit",
      valueNumeric: netProfit,
      icon: <DollarSign size={20} />,
      gradient: netProfit >= 0 ? "from-green-500 to-emerald-600" : "from-rose-500 to-red-600",
    },
  ];

  const revenuePieData = useMemo(
    () => [
      { name: "Restaurant", value: restaurantRevenue },
      { name: "Accommodation", value: accommodationRevenue },
      { name: "Conference", value: conferenceRevenue },
    ],
    [restaurantRevenue, accommodationRevenue, conferenceRevenue]
  );

  const PIE_COLORS = ["#f97316", "#06b6d4", "#a78bfa"];

  const downloadCSV = () => {
    const rows = [
      ["Business", BUSINESS_NAME],
      ["Generated At", new Date().toLocaleString()],
      [],
      ["Metric", "Amount (UGX)"],
      ["Restaurant Revenue", restaurantRevenue.toString()],
      ["Accommodation Revenue", accommodationRevenue.toString()],
      ["Conference Revenue", conferenceRevenue.toString()],
      ["Total Revenue", totalRevenue.toString()],
      ["Total Expenses", summary.totalExpenses.toString()],
      ["Net Profit", netProfit.toString()],
    ];
    const csvContent = rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = CSV_FILENAME;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadPDF = () => {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();

  // Header
  doc.setFontSize(16);
  doc.text(BUSINESS_NAME, pageWidth / 2, 40, { align: "center" });

  doc.setFontSize(11);
  doc.text(
    `Generated: ${new Date().toLocaleString()}`,
    pageWidth / 2,
    60,
    { align: "center" }
  );

  const body = [
    ["Restaurant Revenue", formatUGX(restaurantRevenue ?? 0)],
    ["Accommodation Revenue", formatUGX(accommodationRevenue ?? 0)],
    ["Conference Revenue", formatUGX(conferenceRevenue ?? 0)],
    ["Total Revenue", formatUGX(totalRevenue ?? 0)],
    ["Total Expenses", formatUGX(summary?.totalExpenses ?? 0)],
    ["Net Profit", formatUGX(netProfit ?? 0)],
  ];

  // ✅ Correct autoTable call for Vite
  autoTable(doc, {
    startY: 90,
    head: [["Metric", "Amount (UGX)"]],
    body,
    styles: {
      halign: "left",
      fontSize: 10,
      cellPadding: 6,
    },
    headStyles: {
      fillColor: [37, 99, 235], // Tailwind blue-600
      textColor: 255,
    },
  });

  const finalY = (doc as any).lastAutoTable?.finalY ?? 90;

  // Signature
  doc.setFontSize(10);
  doc.text("__________________________", 60, finalY + 50);
  doc.text("Authorized Signature", 60, finalY + 66);

  doc.save(PDF_FILENAME || "financial-summary.pdf");
};

  return (
    <div className="p-6 space-y-8">
      {/* Header + Export Buttons */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-gray-800 leading-snug">
            Hello 👋, welcome to your Dashboard
          </h2>
          <p className="text-sm text-gray-500 mt-1">Overview of revenues, expenses and occupancy.</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={downloadCSV}
            className="bg-white border border-gray-200 px-4 py-2 rounded-md shadow-sm text-sm font-medium hover:bg-gray-50"
          >
            Export CSV
          </button>
          <button
            onClick={downloadPDF}
            className="bg-blue-600 text-white px-4 py-2 rounded-md shadow-sm text-sm font-medium hover:brightness-90"
          >
            Export PDF
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 w-full">
        {summaryCards.map((item, idx) => (
          <motion.div key={idx} whileHover={{ scale: 1.03 }} className="cursor-pointer">
            <div className={`bg-linear-to-r ${item.gradient} rounded-2xl p-6 shadow-lg text-white flex flex-col justify-between h-40 hover:shadow-2xl`}>
              <div className="flex items-center gap-2 text-sm font-medium">
                {item.icon}
                <span>{item.title}</span>
              </div>
              <div className="text-2xl font-bold leading-tight">
                <CountUp
                  start={0}
                  end={Number(item.valueNumeric ?? 0)}
                  duration={1.2}
                  separator=","
                  formattingFn={(n) => formatUGX(Math.round(Number(n)))}
                />
              </div>
            </div>
          </motion.div>
        ))}
      </div>


      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Expense Trend */}
        <div className="lg:col-span-3 bg-white rounded-2xl shadow-md p-5">
          <div className="flex items-center gap-2 mb-3">
            <PieIcon size={20} className="text-blue-600" />
            <span className="font-semibold text-gray-700">Expense Trend (Last 7 Days)</span>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={expensesData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="day" />
              <YAxis />
              <Tooltip />
              <Line type="monotone" dataKey="expenses" stroke="#2563eb" strokeWidth={3} dot={{ r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Meals Chart */}
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
              <Bar dataKey="meals" radius={[5, 5, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Bookings Chart */}
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
              <Bar dataKey="bookings" radius={[5, 5, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Revenue Pie Chart */}
      <div className="bg-white rounded-2xl shadow-md p-5">
        <div className="flex items-center gap-2 mb-3">
          <PieIcon size={20} className="text-indigo-600" />
          <span className="font-semibold text-gray-700">Revenue Breakdown</span>
        </div>

        <div className="flex flex-col lg:flex-row gap-4 items-center">
          <div style={{ width: 260, height: 260 }} className="mx-auto">
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={revenuePieData}
                  dataKey="value"
                  nameKey="name"
                  outerRadius={90}
                  label={(entry) => {
                    const payload = entry.payload as { name: string; value: number }; // get actual data
                    return payload.value > 0 ? `${payload.name}` : "";
                  }}
                >


                  {revenuePieData.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value: number) => formatUGX(value)} />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="flex-1">
            <ul className="space-y-2">
              {revenuePieData.map((r, i) => (
                <li key={i} className="flex justify-between items-center">
                  <div className="flex items-center gap-3">
                    <span style={{ width: 12, height: 12, background: PIE_COLORS[i], display: "inline-block", borderRadius: 3 }} />
                    <span className="font-medium">{r.name}</span>
                  </div>
                  <div className="text-sm font-semibold">{formatUGX(r.value)}</div>
                </li>
              ))}
              <li className="flex justify-between items-center pt-4 border-t border-gray-100">
                <span className="font-semibold">Total Revenue</span>
                <span className="font-semibold">{formatUGX(totalRevenue)}</span>
              </li>
              <li className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Total Expenses</span>
                <span className="text-sm text-gray-600">{formatUGX(summary.totalExpenses)}</span>
              </li>
              <li className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Net Profit</span>
                <span className={`font-semibold ${netProfit >= 0 ? "text-green-600" : "text-rose-600"}`}>{formatUGX(netProfit)}</span>
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* Room Occupancy */}
      <div className="bg-white rounded-2xl shadow-md p-5">
        <div className="flex items-center gap-2 mb-3">
          <BedDouble size={20} className="text-green-600" />
          <span className="font-semibold text-gray-700">Room Occupancy</span>
        </div>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart
            data={[
              { type: "Occupied", count: summary.occupiedRooms },
              { type: "Free", count: summary.freeRooms },
            ]}
            layout="vertical"
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" />
            <YAxis dataKey="type" type="category" />
            <Tooltip />
            <Bar dataKey="count" fill="#22c55e" radius={[5, 5, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
