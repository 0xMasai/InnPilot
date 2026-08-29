"use client";
// Centralized reporting engine.
// Every figure comes from src/lib/metrics.ts — the same functions that power
// the dashboard — so reports can never disagree with the Overview.
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { onSnapshot } from "firebase/firestore";
import { hotelCollection } from "./lib/hotelScope";
import { useAuth } from "./auth/AuthProvider";
import {
  FileText,
  Printer,
  Download,
  FileSpreadsheet,
  BedDouble,
  Utensils,
  Briefcase,
  Wallet,
  Scale,
} from "lucide-react";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { COLLECTIONS } from "./lib/collections";
import {
  computeMetrics,
  customRange,
  getRange,
  inRange,
  bookingDate,
  orderDate,
  eventDate,
  expenseDate,
  bookingStatusOf,
  isRevenueBooking,
  isRevenueOrder,
  toDateSafe,
  type DatePreset,
  type DateRange,
  type MetricsInput,
} from "./lib/metrics";

type ReportKey = "financial" | "bookings" | "restaurant" | "conference" | "expenses";

const REPORTS: { key: ReportKey; label: string; description: string }[] = [
  { key: "financial", label: "Financial Summary", description: "Revenue, expenses and net operating result" },
  { key: "bookings", label: "Bookings Report", description: "Accommodation bookings for the period" },
  { key: "restaurant", label: "Restaurant Sales", description: "Orders and dining revenue" },
  { key: "conference", label: "Conference & Events", description: "Event bookings and revenue" },
  { key: "expenses", label: "Expense Report", description: "Recorded operational spending" },
];

const PRESETS: { key: DatePreset; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "week", label: "This Week" },
  { key: "month", label: "This Month" },
  { key: "lastMonth", label: "Last Month" },
  { key: "all", label: "All Time" },
];

const ugx = (n: number) => `UGX ${Math.round(n).toLocaleString()}`;
const fmtDateTime = (d: Date | null) => (d ? d.toLocaleString() : "-");

interface BuiltReport {
  title: string;
  kpis: { label: string; value: string }[];
  columns: string[];
  rows: (string | number)[][];
}

export default function ReportsDashboard() {
  const { hotelId } = useAuth();
  const [data, setData] = useState<MetricsInput>({
    bookings: [],
    orders: [],
    events: [],
    expenses: [],
    rooms: [],
  });
  const [report, setReport] = useState<ReportKey>("financial");
  const [preset, setPreset] = useState<DatePreset | "custom">("month");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  useEffect(() => {
    if (!hotelId) return;
    const subs = [
      onSnapshot(hotelCollection(hotelId, COLLECTIONS.BOOKINGS), (s) =>
        setData((p) => ({ ...p, bookings: s.docs.map((d) => d.data()) }))
      ),
      onSnapshot(hotelCollection(hotelId, COLLECTIONS.RESTAURANT), (s) =>
        setData((p) => ({ ...p, orders: s.docs.map((d) => d.data()) }))
      ),
      onSnapshot(hotelCollection(hotelId, COLLECTIONS.CONFERENCE), (s) =>
        setData((p) => ({ ...p, events: s.docs.map((d) => d.data()) }))
      ),
      onSnapshot(hotelCollection(hotelId, COLLECTIONS.EXPENSES), (s) =>
        setData((p) => ({ ...p, expenses: s.docs.map((d) => d.data()) }))
      ),
      onSnapshot(hotelCollection(hotelId, COLLECTIONS.ROOMS), (s) =>
        setData((p) => ({ ...p, rooms: s.docs.map((d) => d.data()) }))
      ),
    ];
    return () => subs.forEach((u) => u());
  }, [hotelId]);

  const range: DateRange = useMemo(() => {
    if (preset === "custom" && customStart && customEnd) {
      const s = new Date(customStart);
      const e = new Date(customEnd);
      if (!isNaN(s.getTime()) && !isNaN(e.getTime()) && s <= e) return customRange(s, e);
    }
    return getRange(preset === "custom" ? "month" : preset);
  }, [preset, customStart, customEnd]);

  const metrics = useMemo(() => computeMetrics(data, range), [data, range]);

  const built: BuiltReport = useMemo(() => {
    switch (report) {
      default:
      case "financial": {
        return {
          title: "Financial Summary",
          kpis: [
            { label: "Total Revenue", value: ugx(metrics.totalRevenue) },
            { label: "Total Expenses", value: ugx(metrics.totalExpenses) },
            { label: "Net Operating Result", value: ugx(metrics.netOperatingResult) },
            {
              label: "Occupancy",
              value:
                metrics.occupancy.rate === null
                  ? "No rooms registered"
                  : `${metrics.occupancy.rate}% (${metrics.occupancy.occupied}/${metrics.occupancy.totalRooms})`,
            },
          ],
          columns: ["Line Item", "Count", "Amount"],
          rows: [
            ["Accommodation Revenue", metrics.bookingsCount, ugx(metrics.accommodationRevenue)],
            ["Restaurant Revenue", metrics.ordersCount, ugx(metrics.restaurantRevenue)],
            ["Conference Revenue", metrics.eventsCount, ugx(metrics.conferenceRevenue)],
            ["Total Revenue", "", ugx(metrics.totalRevenue)],
            ["Recorded Expenses", "", `− ${ugx(metrics.totalExpenses)}`],
            ["Net Operating Result", "", ugx(metrics.netOperatingResult)],
            [
              "Pending Payments (bookings)",
              metrics.pendingPayments.count,
              ugx(metrics.pendingPayments.amount),
            ],
          ],
        };
      }
      case "bookings": {
        const rows = data.bookings
          .filter((b) => inRange(bookingDate(b), range))
          .sort((a, b) => (bookingDate(a)?.getTime() ?? 0) - (bookingDate(b)?.getTime() ?? 0))
          .map((b: any) => [
            String(b.roomNumber ?? "-"),
            b.guestName ?? "-",
            b.roomType ?? "-",
            fmtDateTime(toDateSafe(b.checkIn)),
            fmtDateTime(toDateSafe(b.checkOut)),
            ugx(Number(b.pricePaid) || 0),
            b.paymentStatus ?? "-",
            bookingStatusOf(b),
          ]);
        return {
          title: "Bookings Report",
          kpis: [
            { label: "Bookings", value: String(metrics.bookingsCount) },
            { label: "Accommodation Revenue", value: ugx(metrics.accommodationRevenue) },
            { label: "Pending Payments", value: ugx(metrics.pendingPayments.amount) },
          ],
          columns: ["Room", "Guest", "Type", "Check-in", "Check-out", "Amount", "Payment", "Status"],
          rows,
        };
      }
      case "restaurant": {
        const inPeriod = data.orders.filter((o) => inRange(orderDate(o), range));
        const revenueOrders = inPeriod.filter(isRevenueOrder);
        const avg = revenueOrders.length
          ? metrics.restaurantRevenue / revenueOrders.length
          : 0;
        const rows = inPeriod
          .sort((a, b) => (orderDate(a)?.getTime() ?? 0) - (orderDate(b)?.getTime() ?? 0))
          .map((o: any) => [
            o.clientName ?? "-",
            o.orderDetails ?? "-",
            o.category ?? "-",
            ugx(Number(o.price) || 0),
            o.paymentMethod ?? "-",
            o.status ?? "Paid",
            fmtDateTime(orderDate(o)),
          ]);
        return {
          title: "Restaurant Sales Report",
          kpis: [
            { label: "Sales", value: ugx(metrics.restaurantRevenue) },
            { label: "Orders", value: String(metrics.ordersCount) },
            { label: "Average Order", value: ugx(avg) },
          ],
          columns: ["Client", "Order", "Category", "Price", "Payment", "Status", "Date"],
          rows,
        };
      }
      case "conference": {
        const inPeriod = data.events.filter((e) => inRange(eventDate(e), range));
        const rows = inPeriod
          .sort((a, b) => (eventDate(a)?.getTime() ?? 0) - (eventDate(b)?.getTime() ?? 0))
          .map((e: any) => [
            e.organizerName ?? "-",
            e.room ?? "-",
            e.durationHours ? `${e.durationHours}h` : "-",
            ugx(Number(e.price) || 0),
            fmtDateTime(eventDate(e)),
          ]);
        return {
          title: "Conference & Events Report",
          kpis: [
            { label: "Event Revenue", value: ugx(metrics.conferenceRevenue) },
            { label: "Events", value: String(metrics.eventsCount) },
          ],
          columns: ["Organizer", "Room", "Duration", "Price", "Date"],
          rows,
        };
      }
      case "expenses": {
        const inPeriod = data.expenses.filter((x) => inRange(expenseDate(x), range));
        // Category totals for the KPI strip.
        const byDept = new Map<string, number>();
        for (const x of inPeriod) {
          const k = (x as any).department || "Other";
          byDept.set(k, (byDept.get(k) ?? 0) + (Number(x.amount) || 0));
        }
        const top = [...byDept.entries()].sort((a, b) => b[1] - a[1])[0];
        const rows = inPeriod
          .sort((a, b) => (expenseDate(a)?.getTime() ?? 0) - (expenseDate(b)?.getTime() ?? 0))
          .map((x: any) => [
            x.department ?? "-",
            x.description ?? "-",
            ugx(Number(x.amount) || 0),
            x.notes || "-",
            fmtDateTime(expenseDate(x)),
          ]);
        return {
          title: "Expense Report",
          kpis: [
            { label: "Total Expenses", value: ugx(metrics.totalExpenses) },
            { label: "Entries", value: String(inPeriod.length) },
            { label: "Largest Category", value: top ? `${top[0]} (${ugx(top[1])})` : "—" },
          ],
          columns: ["Department", "Description", "Amount", "Notes", "Date"],
          rows,
        };
      }
    }
  }, [report, data, range, metrics]);

  const fileStem = `${built.title.replace(/\s+/g, "-").toLowerCase()}-${range.label.replace(/[\s/–]+/g, "-").toLowerCase()}`;

  // ---------- Exports ----------

  const exportCsv = () => {
    const esc = (v: string | number) => {
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [
      `${built.title} — ${range.label}`,
      "",
      ...built.kpis.map((k) => `${esc(k.label)},${esc(k.value)}`),
      "",
      built.columns.map(esc).join(","),
      ...built.rows.map((r) => r.map(esc).join(",")),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileStem}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportPdf = () => {
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text(built.title, 14, 18);
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(`Period: ${range.label} · Generated ${new Date().toLocaleString()}`, 14, 25);

    doc.setTextColor(30);
    let y = 34;
    built.kpis.forEach((k) => {
      doc.setFont("helvetica", "bold");
      doc.text(`${k.label}:`, 14, y);
      doc.setFont("helvetica", "normal");
      doc.text(k.value, 70, y);
      y += 6;
    });

    autoTable(doc, {
      startY: y + 4,
      head: [built.columns],
      body: built.rows.map((r) => r.map(String)),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [30, 58, 138] },
    });

    doc.save(`${fileStem}.pdf`);
  };

  const printReport = () => {
    const w = window.open("", "PRINT", "height=800,width=700");
    if (!w) return;
    const kpiHtml = built.kpis
      .map((k) => `<div class="kpi"><div class="kpi-label">${k.label}</div><div class="kpi-value">${k.value}</div></div>`)
      .join("");
    const headHtml = built.columns.map((c) => `<th>${c}</th>`).join("");
    const bodyHtml = built.rows
      .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`)
      .join("");
    w.document.write(`
      <html>
        <head>
          <title>${built.title}</title>
          <style>
            body { font-family: Arial, Helvetica, sans-serif; color: #1e293b; padding: 24px; }
            h1 { font-size: 20px; margin: 0 0 4px; }
            .meta { color: #64748b; font-size: 12px; margin-bottom: 18px; }
            .kpis { display: flex; gap: 18px; flex-wrap: wrap; margin-bottom: 18px; }
            .kpi { border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 14px; }
            .kpi-label { font-size: 11px; color: #64748b; }
            .kpi-value { font-size: 15px; font-weight: bold; }
            table { width: 100%; border-collapse: collapse; font-size: 11px; }
            th { background: #1e3a8a; color: #fff; text-align: left; padding: 6px 8px; }
            td { border-bottom: 1px solid #e2e8f0; padding: 6px 8px; }
            tr:nth-child(even) td { background: #f8fafc; }
          </style>
        </head>
        <body>
          <h1>${built.title}</h1>
          <p class="meta">Period: ${range.label} · Generated ${new Date().toLocaleString()}</p>
          <div class="kpis">${kpiHtml}</div>
          <table><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>
        </body>
      </html>
    `);
    w.document.close();
    w.focus();
    w.print();
  };

  const reportIcons: Record<ReportKey, ReactNode> = {
    financial: <Scale size={17} />,
    bookings: <BedDouble size={17} />,
    restaurant: <Utensils size={17} />,
    conference: <Briefcase size={17} />,
    expenses: <Wallet size={17} />,
  };

  return (
    <div className="space-y-6">
      {/* HEADER */}
      <div className="page-header">
        <div>
          <h2 className="page-title">Reports</h2>
          <p className="page-subtitle">Generate, print and export management reports.</p>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-secondary" onClick={printReport}>
            <Printer size={16} /> Print
          </button>
          <button className="btn btn-secondary" onClick={exportCsv}>
            <FileSpreadsheet size={16} /> CSV
          </button>
          <button className="btn btn-primary" onClick={exportPdf}>
            <Download size={16} /> PDF
          </button>
        </div>
      </div>

      {/* REPORT PICKER */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {REPORTS.map((r) => (
          <button
            key={r.key}
            onClick={() => setReport(r.key)}
            className={`text-left rounded-xl border p-3.5 transition ${
              report === r.key
                ? "border-blue-500 bg-blue-50/60 ring-1 ring-blue-500"
                : "border-slate-200 bg-white hover:border-slate-300"
            }`}
            aria-pressed={report === r.key}
          >
            <div className={`flex items-center gap-2 font-medium text-sm ${report === r.key ? "text-blue-700" : "text-slate-800"}`}>
              {reportIcons[r.key]}
              {r.label}
            </div>
            <p className="text-xs text-slate-500 mt-1">{r.description}</p>
          </button>
        ))}
      </div>

      {/* RANGE PICKER */}
      <div className="filter-bar">
        <div className="flex flex-col lg:flex-row lg:items-center gap-3">
          <div className="flex rounded-lg border border-slate-200 bg-white p-1 gap-1" role="tablist" aria-label="Date range">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                role="tab"
                aria-selected={preset === p.key}
                onClick={() => setPreset(p.key)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${
                  preset === p.key ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {p.label}
              </button>
            ))}
            <button
              role="tab"
              aria-selected={preset === "custom"}
              onClick={() => setPreset("custom")}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${
                preset === "custom" ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              Custom
            </button>
          </div>
          {preset === "custom" && (
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="input"
                aria-label="Start date"
                style={{ width: 160 }}
              />
              <span className="text-slate-400 text-sm">to</span>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="input"
                aria-label="End date"
                style={{ width: 160 }}
              />
            </div>
          )}
          <p className="text-sm muted lg:ml-auto">
            Reporting period: <strong className="text-slate-700">{range.label}</strong>
          </p>
        </div>
      </div>

      {/* KPI SUMMARY */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {built.kpis.map((k) => (
          <div key={k.label} className="stat-card">
            <div className="stat-top">
              <span className="stat-label">{k.label}</span>
              <span className="stat-icon"><FileText size={17} /></span>
            </div>
            <div className="stat-value" style={{ fontSize: 20 }}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* REPORT TABLE */}
      <div className="card card-pad">
        <h2 className="section-title mb-4">{built.title} — {range.label}</h2>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                {built.columns.map((c) => (
                  <th key={c}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {built.rows.length ? (
                built.rows.map((r, i) => (
                  <tr key={i}>
                    {r.map((c, j) => (
                      <td key={j} className={j === 0 ? "font-medium text-slate-800" : ""}>
                        {c}
                      </td>
                    ))}
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={built.columns.length}>
                    <div className="empty-state">
                      <div className="empty-icon"><FileText size={24} /></div>
                      <p className="empty-title">No data in this period</p>
                      <p className="empty-desc">Try a wider date range.</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
