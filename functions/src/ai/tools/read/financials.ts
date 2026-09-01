/**
 * Money and occupancy tools.
 *
 * Every number here comes from `computeMetrics` in `src/lib/metrics.ts` —
 * the same function, over the same combined sources, that produces the
 * Overview and Reports screens. Nothing is recalculated locally, so an AI
 * answer and the dashboard cannot disagree.
 */
import {
  computeMetrics,
  expenseDate,
  inRange,
  isRevenueOrder,
  orderDate,
} from "../../../../../src/lib/metrics";
import type { ToolDeps } from "../../types";
import { HOTEL_STAFF_ROLES, defineReadTool } from "../defineTool";
import { cleanLabel } from "../sanitize";
import {
  PERIOD_SCHEMA,
  describeRange,
  resolveRange,
  validatePeriodInput,
  type PeriodInput,
} from "../inputs";

/** Shared preamble so every result says where its numbers came from. */
const SOURCE_NOTE =
  "Computed by InnPilot's shared metrics module over this hotel's recorded data (accommodation + reservations, restaurant, conference, expenses). Matches the Overview and Reports dashboards.";

async function metricsFor(input: PeriodInput, deps: ToolDeps) {
  const range = resolveRange(input, deps.now);
  const metrics = computeMetrics(await deps.data.metricsInput(), range);
  return { range, metrics };
}

export const getOccupancy = defineReadTool<PeriodInput, unknown>({
  name: "get_occupancy",
  description:
    "Current room occupancy for the hotel: how many rooms are occupied, available, and the occupancy rate. Occupancy reflects live room status, not the selected period.",
  inputSchema: PERIOD_SCHEMA,
  allowedRoles: [...HOTEL_STAFF_ROLES],
  validateInput: validatePeriodInput,
  async handler(_ctx, input, deps) {
    const { metrics } = await metricsFor(input, deps);
    const { totalRooms, occupied, available, rate } = metrics.occupancy;

    return {
      totalRooms,
      occupied,
      available,
      // null (not 0) when no rooms are registered — an undefined rate is a
      // finding to report, not a figure to invent.
      occupancyRatePercent: rate,
      otherStatuses: totalRooms - occupied - available,
      note:
        totalRooms === 0
          ? "No rooms are registered for this hotel, so occupancy is undefined."
          : SOURCE_NOTE,
    };
  },
});

export const getRevenue = defineReadTool<PeriodInput, unknown>({
  name: "get_revenue",
  description:
    "Revenue for a period, broken down into accommodation, restaurant and conference, with total revenue, recorded expenses and net operating result. Use for any 'how much did we make' question.",
  inputSchema: PERIOD_SCHEMA,
  allowedRoles: [...HOTEL_STAFF_ROLES],
  validateInput: validatePeriodInput,
  async handler(_ctx, input, deps) {
    const { range, metrics } = await metricsFor(input, deps);
    return {
      period: describeRange(range),
      currency: "UGX",
      accommodationRevenue: metrics.accommodationRevenue,
      restaurantRevenue: metrics.restaurantRevenue,
      conferenceRevenue: metrics.conferenceRevenue,
      totalRevenue: metrics.totalRevenue,
      totalExpenses: metrics.totalExpenses,
      // Not "profit": only revenue and expenses recorded in InnPilot.
      netOperatingResult: metrics.netOperatingResult,
      bookingsCount: metrics.bookingsCount,
      pendingPayments: metrics.pendingPayments,
      note: SOURCE_NOTE,
    };
  },
});

export const getExpenses = defineReadTool<PeriodInput, unknown>({
  name: "get_expenses",
  description:
    "Recorded expenses for a period, with a breakdown by department. Only covers expenses entered into InnPilot.",
  inputSchema: PERIOD_SCHEMA,
  allowedRoles: [...HOTEL_STAFF_ROLES],
  validateInput: validatePeriodInput,
  async handler(_ctx, input, deps) {
    const range = resolveRange(input, deps.now);
    const expenses = await deps.data.expenses();

    const byDepartment = new Map<string, { count: number; amount: number }>();
    let total = 0;
    let count = 0;

    for (const expense of expenses) {
      if (!inRange(expenseDate(expense), range)) continue;
      const amount = Number(expense.amount) || 0;
      const department = cleanLabel(expense.department, "Unspecified");
      const bucket = byDepartment.get(department) ?? { count: 0, amount: 0 };
      bucket.count += 1;
      bucket.amount += amount;
      byDepartment.set(department, bucket);
      total += amount;
      count += 1;
    }

    return {
      period: describeRange(range),
      currency: "UGX",
      totalExpenses: total,
      expenseCount: count,
      byDepartment: Array.from(byDepartment, ([department, value]) => ({
        department,
        ...value,
      })).sort((a, b) => b.amount - a.amount),
      note: "Only expenses recorded in InnPilot are included.",
    };
  },
});

export const getRestaurantSales = defineReadTool<PeriodInput, unknown>({
  name: "get_restaurant_sales",
  description:
    "Restaurant revenue and order count for a period, with a breakdown by menu category. Cancelled orders are excluded.",
  inputSchema: PERIOD_SCHEMA,
  allowedRoles: [...HOTEL_STAFF_ROLES],
  validateInput: validatePeriodInput,
  async handler(_ctx, input, deps) {
    const range = resolveRange(input, deps.now);
    const orders = await deps.data.orders();

    const byCategory = new Map<string, { count: number; amount: number }>();
    let total = 0;
    let count = 0;

    for (const order of orders) {
      if (!isRevenueOrder(order)) continue;
      if (!inRange(orderDate(order), range)) continue;
      const amount = Number(order.price) || 0;
      const category = cleanLabel(order.category, "Uncategorised");
      const bucket = byCategory.get(category) ?? { count: 0, amount: 0 };
      bucket.count += 1;
      bucket.amount += amount;
      byCategory.set(category, bucket);
      total += amount;
      count += 1;
    }

    return {
      period: describeRange(range),
      currency: "UGX",
      restaurantRevenue: total,
      orderCount: count,
      byCategory: Array.from(byCategory, ([category, value]) => ({ category, ...value })).sort(
        (a, b) => b.amount - a.amount
      ),
      note: "Cancelled orders generate no revenue and are excluded.",
    };
  },
});

export const getConferenceRevenue = defineReadTool<PeriodInput, unknown>({
  name: "get_conference_revenue",
  description:
    "Conference and events revenue for a period, with the number of bookings.",
  inputSchema: PERIOD_SCHEMA,
  allowedRoles: [...HOTEL_STAFF_ROLES],
  validateInput: validatePeriodInput,
  async handler(_ctx, input, deps) {
    const { range, metrics } = await metricsFor(input, deps);
    return {
      period: describeRange(range),
      currency: "UGX",
      conferenceRevenue: metrics.conferenceRevenue,
      eventsCount: metrics.eventsCount,
      note: SOURCE_NOTE,
    };
  },
});
