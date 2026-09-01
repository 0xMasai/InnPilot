/**
 * Report tools (daily / weekly / monthly).
 *
 * A report is a composition of figures the other tools already return, not
 * a second implementation of them: `computeMetrics` for money and
 * occupancy, the Front Desk definitions for arrivals/departures/in-house.
 * That keeps a report and the individual questions behind it consistent —
 * "generate today's report" and "what's our revenue today?" cannot
 * disagree.
 *
 * These return structured data, not prose. The model writes the narrative;
 * the tool supplies only retrieved facts.
 */
import { computeMetrics, getRange, customRange } from "../../../../../src/lib/metrics";
import { isSameDay, toPMSDate } from "../../../../../src/lib/pms";
import type { DateRange } from "../../../../../src/lib/metrics";
import type { ToolDefinition, ToolDeps } from "../../types";
import {
  DAY_SCHEMA,
  describeRange,
  resolveDay,
  validateDayInput,
  type DayInput,
} from "../inputs";

const ALL_STAFF = ["hotel_admin", "staff"] as const;

/**
 * The shared body of all three reports. `range` decides the money window;
 * `anchor` decides which day's arrivals/departures are reported (a weekly
 * or monthly report still reports today's front-desk position, which is
 * what a manager asking for one actually wants to see).
 */
async function buildReport(range: DateRange, anchor: Date, deps: ToolDeps) {
  const [metricsInput, reservations] = await Promise.all([
    deps.data.metricsInput(),
    deps.data.reservations(),
  ]);

  const metrics = computeMetrics(metricsInput, range);

  const arrivals = reservations.filter(
    (b) => b.status === "Confirmed" && isSameDay(toPMSDate(b.checkIn as never), anchor)
  );
  const departures = reservations.filter(
    (b) => b.status === "Checked In" && isSameDay(toPMSDate(b.checkOut as never), anchor)
  );
  const inHouse = reservations.filter((b) => b.status === "Checked In");
  const unsettled = reservations
    .filter((b) => b.status === "Checked In" || b.status === "Confirmed")
    .reduce((sum, b) => sum + (b.paymentStatus === "Paid" ? 0 : Number(b.pricePaid || 0)), 0);

  return {
    period: describeRange(range),
    currency: "UGX",
    revenue: {
      accommodation: metrics.accommodationRevenue,
      restaurant: metrics.restaurantRevenue,
      conference: metrics.conferenceRevenue,
      total: metrics.totalRevenue,
    },
    expenses: metrics.totalExpenses,
    netOperatingResult: metrics.netOperatingResult,
    occupancy: {
      totalRooms: metrics.occupancy.totalRooms,
      occupied: metrics.occupancy.occupied,
      available: metrics.occupancy.available,
      ratePercent: metrics.occupancy.rate,
    },
    activity: {
      bookingsCount: metrics.bookingsCount,
      restaurantOrders: metrics.ordersCount,
      conferenceEvents: metrics.eventsCount,
    },
    frontDesk: {
      asOf: anchor.toISOString().slice(0, 10),
      arrivals: arrivals.length,
      departures: departures.length,
      inHouse: inHouse.length,
    },
    outstanding: {
      pendingPaymentsCount: metrics.pendingPayments.count,
      pendingPaymentsAmount: metrics.pendingPayments.amount,
      unsettledFrontDeskBalance: unsettled,
    },
    notes: [
      "Net operating result = total revenue - recorded expenses. It is not profit.",
      "Occupancy reflects live room status, not the report period.",
      metrics.occupancy.totalRooms === 0
        ? "No rooms are registered, so occupancy rate is undefined."
        : null,
    ].filter(Boolean),
  };
}

export const generateDailyReport: ToolDefinition<DayInput> = {
  name: "generate_daily_report",
  description:
    "Structured operational report for one day: revenue by stream, expenses, net operating result, occupancy, arrivals/departures/in-house, and outstanding balances. Defaults to today.",
  inputSchema: DAY_SCHEMA,
  allowedRoles: [...ALL_STAFF],
  isWrite: false,
  validateInput: validateDayInput,
  async handler(_ctx, input, deps) {
    const anchor = resolveDay(input, deps.now);
    const range = input.date
      ? customRange(anchor, anchor)
      : getRange("today", deps.now);
    return buildReport(range, anchor, deps);
  },
};

export const generateWeeklyReport: ToolDefinition<DayInput> = {
  name: "generate_weekly_report",
  description:
    "Structured operational report for a week (Monday to Sunday) containing the given date, defaulting to the current week. Same figures as the daily report, over a week.",
  inputSchema: DAY_SCHEMA,
  allowedRoles: [...ALL_STAFF],
  isWrite: false,
  validateInput: validateDayInput,
  async handler(_ctx, input, deps) {
    const anchor = resolveDay(input, deps.now);
    return buildReport(getRange("week", anchor), anchor, deps);
  },
};

export const generateMonthlyReport: ToolDefinition<DayInput> = {
  name: "generate_monthly_report",
  description:
    "Structured operational report for the calendar month containing the given date, defaulting to the current month. Same figures as the daily report, over a month.",
  inputSchema: DAY_SCHEMA,
  allowedRoles: [...ALL_STAFF],
  isWrite: false,
  validateInput: validateDayInput,
  async handler(_ctx, input, deps) {
    const anchor = resolveDay(input, deps.now);
    return buildReport(getRange("month", anchor), anchor, deps);
  },
};
