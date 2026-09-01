/**
 * Money tools.
 *
 * Every figure here comes from `computeMetrics` in src/lib/metrics.ts —
 * the same function the Overview and Reports pages call, over the same
 * combined booking sources and the same date ranges. That is deliberate:
 * an assistant that computes revenue its own way would eventually
 * contradict the dashboard, and the manager would have no way to tell
 * which was right.
 *
 * Amounts are in UGX, matching `money()` in src/lib/pms.ts. The currency
 * is returned on every result rather than assumed by the model.
 */
import type { ToolDefinition } from "../../types";
import { STAFF_AND_ADMIN } from "../roles";
import { fetchEvents, fetchExpenses, fetchMetricsInput, fetchOrders } from "../dataAccess";
import { PERIOD_SCHEMA_PROPERTIES, parsePeriod, type PeriodInput } from "../validation";
import {
  computeMetrics,
  eventDate,
  expenseDate,
  inRange,
  isRevenueOrder,
  orderDate,
  type DateRange,
} from "../../../../src/lib/metrics";

const CURRENCY = "UGX";

const periodSchema = {
  type: "object",
  properties: PERIOD_SCHEMA_PROPERTIES,
  additionalProperties: false,
} as const;

function rangeInfo(range: DateRange) {
  return {
    label: range.label,
    from: range.start.toISOString(),
    // `end` is exclusive in metrics.ts; report the inclusive last moment
    // so the model never describes the range as a day longer than it is.
    to: new Date(range.end.getTime() - 1).toISOString(),
  };
}

/** Sum amounts into named buckets, biggest first. */
function breakdown(rows: { key: string; amount: number }[]) {
  const totals = new Map<string, { total: number; count: number }>();
  for (const row of rows) {
    const bucket = totals.get(row.key) ?? { total: 0, count: 0 };
    bucket.total += row.amount;
    bucket.count += 1;
    totals.set(row.key, bucket);
  }
  return [...totals.entries()]
    .map(([name, bucket]) => ({ name, ...bucket }))
    .sort((a, b) => b.total - a.total);
}

export const getRevenue: ToolDefinition<PeriodInput, unknown> = {
  name: "get_revenue",
  description:
    "Revenue for a period, already broken down into accommodation, restaurant " +
    "and conference, with recorded expenses and the net operating result. The " +
    "same calculation the Overview and Reports pages show. " +
    "USE FOR: 'how much did we make', 'revenue this week', 'are we profitable', " +
    "and any comparison of income against spending. " +
    "THIS ALONE IS ENOUGH for a revenue question: it already contains the " +
    "restaurant, conference and expense totals, so do not also call " +
    "get_restaurant_sales, get_conference_revenue or get_expenses unless the " +
    "user asks specifically how a total breaks down by category or department.",
  allowedRoles: STAFF_AND_ADMIN,
  isWrite: false,
  inputSchema: periodSchema,
  validateInput: parsePeriod,
  handler: async (ctx, input) => {
    const metrics = computeMetrics(
      await fetchMetricsInput(ctx.hotelId as string),
      input.range
    );

    return {
      currency: CURRENCY,
      period: rangeInfo(input.range),
      accommodationRevenue: metrics.accommodationRevenue,
      restaurantRevenue: metrics.restaurantRevenue,
      conferenceRevenue: metrics.conferenceRevenue,
      totalRevenue: metrics.totalRevenue,
      recordedExpenses: metrics.totalExpenses,
      netOperatingResult: metrics.netOperatingResult,
      counts: {
        bookings: metrics.bookingsCount,
        restaurantOrders: metrics.ordersCount,
        conferenceEvents: metrics.eventsCount,
      },
      pendingPayments: metrics.pendingPayments,
      definitions: {
        netOperatingResult:
          "Total revenue minus expenses recorded in InnPilot. Not profit — it " +
          "only reflects what this system holds.",
        accommodationRevenue:
          "Sum of pricePaid on non-cancelled bookings, dated by check-in. " +
          "Front-desk reservations are created with pricePaid 0 until a " +
          "payment is recorded, so they count towards bookings but not " +
          "revenue until then.",
      },
    };
  },
};

export const getExpenses: ToolDefinition<PeriodInput, unknown> = {
  name: "get_expenses",
  description:
    "Expenses for a period, broken down BY DEPARTMENT. " +
    "USE FOR: 'what did we spend on', 'which department costs most', " +
    "'break down our expenses'. " +
    "NOT FOR: the expense total alone or expenses against revenue — " +
    "get_revenue returns both, in one call.",
  allowedRoles: STAFF_AND_ADMIN,
  isWrite: false,
  inputSchema: periodSchema,
  validateInput: parsePeriod,
  handler: async (ctx, input) => {
    const expenses = await fetchExpenses(ctx.hotelId as string);
    const rows = expenses
      .filter((expense) => inRange(expenseDate(expense), input.range))
      .map((expense) => ({
        key: expense.department || "Unspecified",
        amount: Number(expense.amount) || 0,
      }));

    return {
      currency: CURRENCY,
      period: rangeInfo(input.range),
      total: rows.reduce((sum, row) => sum + row.amount, 0),
      count: rows.length,
      byDepartment: breakdown(rows),
    };
  },
};

export const getRestaurantSales: ToolDefinition<PeriodInput, unknown> = {
  name: "get_restaurant_sales",
  description:
    "Restaurant sales for a period, broken down BY CATEGORY, excluding " +
    "cancelled orders. " +
    "USE FOR: 'how did the restaurant do', 'what sells best', 'food vs drinks'. " +
    "NOT FOR: the restaurant total as part of overall revenue — get_revenue " +
    "already includes it.",
  allowedRoles: STAFF_AND_ADMIN,
  isWrite: false,
  inputSchema: periodSchema,
  validateInput: parsePeriod,
  handler: async (ctx, input) => {
    const orders = await fetchOrders(ctx.hotelId as string);
    const rows = orders
      .filter((order) => isRevenueOrder(order) && inRange(orderDate(order), input.range))
      .map((order) => ({
        key: order.category || "Uncategorised",
        amount: Number(order.price) || 0,
      }));

    return {
      currency: CURRENCY,
      period: rangeInfo(input.range),
      total: rows.reduce((sum, row) => sum + row.amount, 0),
      orderCount: rows.length,
      byCategory: breakdown(rows),
    };
  },
};

interface ConferenceEvent {
  price?: number;
  room?: string;
  attendees?: number;
  createdAt?: unknown;
}

export const getConferenceRevenue: ToolDefinition<PeriodInput, unknown> = {
  name: "get_conference_revenue",
  description:
    "Conference and events revenue for a period, broken down BY ROOM, with " +
    "attendee numbers. " +
    "USE FOR: 'how are events doing', 'which conference room earns most', " +
    "'how many people attended'. " +
    "NOT FOR: the conference total as part of overall revenue — get_revenue " +
    "already includes it.",
  allowedRoles: STAFF_AND_ADMIN,
  isWrite: false,
  inputSchema: periodSchema,
  validateInput: parsePeriod,
  handler: async (ctx, input) => {
    const events = (await fetchEvents(ctx.hotelId as string)) as ConferenceEvent[];
    const booked = events.filter((event) => inRange(eventDate(event), input.range));

    return {
      currency: CURRENCY,
      period: rangeInfo(input.range),
      total: booked.reduce((sum, event) => sum + (Number(event.price) || 0), 0),
      eventCount: booked.length,
      totalAttendees: booked.reduce(
        (sum, event) => sum + (Number(event.attendees) || 0),
        0
      ),
      byRoom: breakdown(
        booked.map((event) => ({
          key: event.room || "Unspecified",
          amount: Number(event.price) || 0,
        }))
      ),
    };
  },
};
