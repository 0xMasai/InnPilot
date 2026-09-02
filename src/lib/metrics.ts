/**
 * Centralized business calculations.
 *
 * Every dashboard, chart and (future) report must derive its numbers from
 * these functions so figures agree across the entire application.
 *
 * Definitions:
 *   Total Revenue        = Accommodation + Restaurant + Conference revenue
 *   Net Operating Result = Total Revenue − Recorded Expenses
 *     (deliberately NOT labeled "Profit": it only reflects revenue and
 *      expenses recorded in this system.)
 *
 * Revenue recognition dates:
 *   Accommodation → checkIn (fallback createdAt)
 *   Restaurant    → createdAt (fallback timestamp)
 *   Conference    → createdAt
 *   Expenses      → createdAt (fallback timestamp/date)
 */
import type { BookingStatus } from "./collections";

// ---------- Raw record shapes (as stored in Firestore) ----------

export interface BookingRecord {
  pricePaid?: number;
  paymentStatus?: string;
  status?: BookingStatus;
  isOccupied?: boolean;
  checkIn?: unknown;
  checkOut?: unknown;
  createdAt?: unknown;
  roomNumber?: unknown;
  guestName?: string;
  roomType?: string;
}

export interface OrderRecord {
  clientName?: string;
  orderDetails?: string;
  category?: string;
  price?: number;
  paymentMethod?: string;
  status?: string;
  createdAt?: unknown;
  timestamp?: unknown;
}

/** Cancelled orders generate no revenue (legacy orders count as completed). */
export const isRevenueOrder = (o: OrderRecord): boolean =>
  (o.status ?? "Paid") !== "Cancelled";

export interface EventRecord {
  organizerName?: string;
  room?: string;
  durationHours?: number;
  price?: number;
  createdAt?: unknown;
  timestamp?: unknown;
}

export interface ExpenseRecord {
  amount?: number;
  department?: string;
  description?: string;
  notes?: string;
  createdAt?: unknown;
  timestamp?: unknown;
  date?: unknown;
}

export interface RoomRecord {
  status?: string;
}

// ---------- Date helpers ----------

export const toDateSafe = (v: unknown): Date | null => {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  // Firestore Timestamps are matched by their toDate() method below rather
  // than by `instanceof Timestamp`, so this module stays free of the client
  // SDK: the AI tools run on firebase-admin, whose Timestamp is a different
  // class, and both satisfy the duck-typed check.
  if (v && typeof v === "object" && "toDate" in v && typeof (v as { toDate: () => unknown }).toDate === "function") {
    try {
      const d = (v as { toDate: () => unknown }).toDate();
      return d instanceof Date && !isNaN(d.getTime()) ? d : null;
    } catch {
      return null;
    }
  }
  if (typeof v === "string" || typeof v === "number" || v instanceof Date) {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
};

export type DatePreset = "today" | "week" | "month" | "lastMonth" | "all";

export interface DateRange {
  start: Date;
  /** Exclusive. */
  end: Date;
  label: string;
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

export const getRange = (preset: DatePreset, now = new Date()): DateRange => {
  const today = startOfDay(now);
  switch (preset) {
    case "today": {
      const end = new Date(today);
      end.setDate(end.getDate() + 1);
      return { start: today, end, label: "Today" };
    }
    case "week": {
      // Monday-based week.
      const start = new Date(today);
      start.setDate(start.getDate() - ((today.getDay() + 6) % 7));
      const end = new Date(start);
      end.setDate(end.getDate() + 7);
      return { start, end, label: "This Week" };
    }
    case "month": {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      return { start, end, label: "This Month" };
    }
    case "lastMonth": {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 1);
      return { start, end, label: "Last Month" };
    }
    case "all": {
      // Cumulative: everything ever recorded up to (and including) today.
      const end = new Date(today);
      end.setDate(end.getDate() + 1);
      return { start: new Date(2000, 0, 1), end, label: "All Time" };
    }
  }
};

/** Build an inclusive custom range from two calendar dates. */
export const customRange = (start: Date, endInclusive: Date): DateRange => {
  const s = startOfDay(start);
  const e = startOfDay(endInclusive);
  e.setDate(e.getDate() + 1); // make end exclusive
  return {
    start: s,
    end: e,
    label: `${s.toLocaleDateString()} – ${endInclusive.toLocaleDateString()}`,
  };
};

export const inRange = (d: Date | null, range: DateRange): boolean =>
  !!d && d >= range.start && d < range.end;

// ---------- Record accessors ----------

/** Legacy bookings have no status; derive one the same way everywhere. */
export const bookingStatusOf = (b: BookingRecord): BookingStatus =>
  b.status ?? (b.isOccupied ? "Checked In" : "Confirmed");

/** Cancelled / no-show bookings generate no revenue. */
export const isRevenueBooking = (b: BookingRecord): boolean => {
  const s = bookingStatusOf(b);
  return s !== "Cancelled" && s !== "No Show";
};

export const bookingDate = (b: BookingRecord) =>
  toDateSafe(b.checkIn) ?? toDateSafe(b.createdAt);
export const orderDate = (o: OrderRecord) =>
  toDateSafe(o.createdAt) ?? toDateSafe(o.timestamp);
export const eventDate = (e: EventRecord) => toDateSafe(e.createdAt);
export const expenseDate = (e: ExpenseRecord) =>
  toDateSafe(e.createdAt) ?? toDateSafe(e.timestamp) ?? toDateSafe(e.date);

// ---------- Aggregation ----------

export interface MetricsInput {
  bookings: BookingRecord[];
  orders: OrderRecord[];
  events: EventRecord[];
  expenses: ExpenseRecord[];
  rooms: RoomRecord[];
}

export interface Metrics {
  accommodationRevenue: number;
  restaurantRevenue: number;
  conferenceRevenue: number;
  totalRevenue: number;
  totalExpenses: number;
  netOperatingResult: number;
  bookingsCount: number;
  ordersCount: number;
  eventsCount: number;
  pendingPayments: { count: number; amount: number };
  occupancy: {
    totalRooms: number;
    occupied: number;
    available: number;
    /** 0–100, null when no rooms are registered. */
    rate: number | null;
  };
}

export const computeMetrics = (input: MetricsInput, range: DateRange): Metrics => {
  let accommodationRevenue = 0;
  let bookingsCount = 0;
  let pendingCount = 0;
  let pendingAmount = 0;

  for (const b of input.bookings) {
    if (!isRevenueBooking(b)) continue;
    if (!inRange(bookingDate(b), range)) continue;
    bookingsCount += 1;
    const amount = Number(b.pricePaid) || 0;
    accommodationRevenue += amount;
    if ((b.paymentStatus || "").toLowerCase() === "pending") {
      pendingCount += 1;
      pendingAmount += amount;
    }
  }

  let restaurantRevenue = 0;
  let ordersCount = 0;
  for (const o of input.orders) {
    if (!isRevenueOrder(o)) continue;
    if (!inRange(orderDate(o), range)) continue;
    ordersCount += 1;
    restaurantRevenue += Number(o.price) || 0;
  }

  let conferenceRevenue = 0;
  let eventsCount = 0;
  for (const e of input.events) {
    if (!inRange(eventDate(e), range)) continue;
    eventsCount += 1;
    conferenceRevenue += Number(e.price) || 0;
  }

  let totalExpenses = 0;
  for (const x of input.expenses) {
    if (!inRange(expenseDate(x), range)) continue;
    totalExpenses += Number(x.amount) || 0;
  }

  const totalRevenue = accommodationRevenue + restaurantRevenue + conferenceRevenue;

  const totalRooms = input.rooms.length;
  const occupied = input.rooms.filter((r) => r.status === "Occupied").length;
  const available = input.rooms.filter((r) => r.status === "Available").length;

  return {
    accommodationRevenue,
    restaurantRevenue,
    conferenceRevenue,
    totalRevenue,
    totalExpenses,
    netOperatingResult: totalRevenue - totalExpenses,
    bookingsCount,
    ordersCount,
    eventsCount,
    pendingPayments: { count: pendingCount, amount: pendingAmount },
    occupancy: {
      totalRooms,
      occupied,
      available,
      rate: totalRooms ? Math.round((occupied / totalRooms) * 100) : null,
    },
  };
};

// ---------- Daily trend series ----------

export interface DailyPoint {
  label: string;
  revenue: number;
  expenses: number;
}

/** One point per month: used when a range is too long for a daily series. */
const monthlySeries = (input: MetricsInput, range: DateRange): DailyPoint[] => {
  // Clamp the start to the earliest dated record so "All Time" doesn't
  // produce hundreds of empty months.
  const dates: Date[] = [];
  for (const b of input.bookings) {
    if (isRevenueBooking(b)) { const d = bookingDate(b); if (d) dates.push(d); }
  }
  for (const o of input.orders) {
    if (isRevenueOrder(o)) { const d = orderDate(o); if (d) dates.push(d); }
  }
  for (const e of input.events) { const d = eventDate(e); if (d) dates.push(d); }
  for (const x of input.expenses) { const d = expenseDate(x); if (d) dates.push(d); }

  const inWindow = dates.filter((d) => d >= range.start && d < range.end);
  if (!inWindow.length) return [];
  const earliest = new Date(Math.min(...inWindow.map((d) => d.getTime())));

  const start = new Date(earliest.getFullYear(), earliest.getMonth(), 1);
  const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

  const index = new Map<string, DailyPoint>();
  for (let m = new Date(start); m < range.end; m.setMonth(m.getMonth() + 1)) {
    index.set(key(m), {
      label: m.toLocaleDateString(undefined, { month: "short", year: "numeric" }),
      revenue: 0,
      expenses: 0,
    });
  }

  const add = (date: Date | null, field: "revenue" | "expenses", amount: number) => {
    if (!date || date < range.start || date >= range.end) return;
    const p = index.get(key(date));
    if (p) p[field] += amount;
  };

  for (const b of input.bookings) {
    if (isRevenueBooking(b)) add(bookingDate(b), "revenue", Number(b.pricePaid) || 0);
  }
  for (const o of input.orders) {
    if (isRevenueOrder(o)) add(orderDate(o), "revenue", Number(o.price) || 0);
  }
  for (const e of input.events) add(eventDate(e), "revenue", Number(e.price) || 0);
  for (const x of input.expenses) add(expenseDate(x), "expenses", Number(x.amount) || 0);

  return [...index.values()];
};

/** One point per day across the range: total revenue vs recorded expenses.
 *  Ranges longer than ~3 months automatically switch to monthly points. */
export const dailySeries = (input: MetricsInput, range: DateRange): DailyPoint[] => {
  const days: Date[] = [];
  for (let d = new Date(range.start); d < range.end; d.setDate(d.getDate() + 1)) {
    days.push(new Date(d));
  }
  if (days.length === 0) return [];
  if (days.length > 92) return monthlySeries(input, range);

  const key = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  const index = new Map<string, DailyPoint>();
  const manyDays = days.length > 10;
  for (const d of days) {
    index.set(key(d), {
      label: manyDays
        ? d.toLocaleDateString(undefined, { day: "numeric", month: "short" })
        : d.toLocaleDateString(undefined, { weekday: "short" }),
      revenue: 0,
      expenses: 0,
    });
  }

  const add = (date: Date | null, field: "revenue" | "expenses", amount: number) => {
    if (!date) return;
    const p = index.get(key(date));
    if (p) p[field] += amount;
  };

  for (const b of input.bookings) {
    if (isRevenueBooking(b)) add(bookingDate(b), "revenue", Number(b.pricePaid) || 0);
  }
  for (const o of input.orders) {
    if (isRevenueOrder(o)) add(orderDate(o), "revenue", Number(o.price) || 0);
  }
  for (const e of input.events) add(eventDate(e), "revenue", Number(e.price) || 0);
  for (const x of input.expenses) add(expenseDate(x), "expenses", Number(x.amount) || 0);

  return [...index.values()];
};
