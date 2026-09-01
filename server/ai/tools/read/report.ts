/**
 * The report tool.
 *
 * One tool with a period argument rather than the three
 * (daily/weekly/monthly) the Phase 1 plan sketched: the three would have
 * had identical bodies and identical output, differing only in a constant,
 * and three near-identical tool descriptions are exactly what makes a
 * model pick the wrong one. `period` maps onto the same presets the
 * Reports page offers.
 *
 * It returns structured data, never prose — the model writes the report
 * from these numbers, so every figure in it traces back to `computeMetrics`
 * and can be checked against the dashboard.
 */
import type { ToolDefinition } from "../../types";
import { STAFF_AND_ADMIN } from "../roles";
import { fetchMetricsInput } from "../dataAccess";
import { PERIOD_SCHEMA_PROPERTIES, parsePeriod, type PeriodInput } from "../validation";
import {
  bookingStatusOf,
  computeMetrics,
  expenseDate,
  inRange,
  isRevenueOrder,
  orderDate,
} from "../../../../src/lib/metrics";
import { isSameDay, toPMSDate } from "../../../../src/lib/pms";

const CURRENCY = "UGX";

export const generateReport: ToolDefinition<PeriodInput, unknown> = {
  name: "generate_report",
  description:
    "A full operations report for a period: occupancy, arrivals and " +
    "departures, revenue by source, expenses by department, and outstanding " +
    "payments. Use for 'generate today's report', 'how did this week go', or " +
    "any request for an overall summary.",
  allowedRoles: STAFF_AND_ADMIN,
  isWrite: false,
  inputSchema: {
    type: "object",
    properties: PERIOD_SCHEMA_PROPERTIES,
    additionalProperties: false,
  },
  validateInput: parsePeriod,
  handler: async (ctx, input) => {
    const data = await fetchMetricsInput(ctx.hotelId as string);
    const metrics = computeMetrics(data, input.range);
    const today = new Date();

    const arrivalsToday = data.bookings.filter((booking) =>
      isSameDay(toPMSDate(booking.checkIn as never), today)
    ).length;
    const departuresToday = data.bookings.filter((booking) =>
      isSameDay(toPMSDate(booking.checkOut as never), today)
    ).length;
    const inHouse = data.bookings.filter(
      (booking) => bookingStatusOf(booking) === "Checked In"
    ).length;

    const expensesByDepartment = new Map<string, number>();
    for (const expense of data.expenses) {
      if (!inRange(expenseDate(expense), input.range)) continue;
      const key = expense.department || "Unspecified";
      expensesByDepartment.set(
        key,
        (expensesByDepartment.get(key) ?? 0) + (Number(expense.amount) || 0)
      );
    }

    const restaurantByCategory = new Map<string, number>();
    for (const order of data.orders) {
      if (!isRevenueOrder(order) || !inRange(orderDate(order), input.range)) continue;
      const key = order.category || "Uncategorised";
      restaurantByCategory.set(
        key,
        (restaurantByCategory.get(key) ?? 0) + (Number(order.price) || 0)
      );
    }

    const rank = (totals: Map<string, number>) =>
      [...totals.entries()]
        .map(([name, total]) => ({ name, total }))
        .sort((a, b) => b.total - a.total);

    return {
      currency: CURRENCY,
      period: {
        label: input.range.label,
        from: input.range.start.toISOString(),
        to: new Date(input.range.end.getTime() - 1).toISOString(),
      },
      generatedAt: today.toISOString(),
      occupancy: {
        totalRooms: metrics.occupancy.totalRooms,
        occupied: metrics.occupancy.occupied,
        available: metrics.occupancy.available,
        ratePercent: metrics.occupancy.rate,
      },
      // Occupancy and today's movements are point-in-time; they describe now,
      // not the reporting period, and the report should say so.
      todayAtAGlance: { arrivals: arrivalsToday, departures: departuresToday, inHouse },
      revenue: {
        accommodation: metrics.accommodationRevenue,
        restaurant: metrics.restaurantRevenue,
        conference: metrics.conferenceRevenue,
        total: metrics.totalRevenue,
      },
      expenses: {
        total: metrics.totalExpenses,
        byDepartment: rank(expensesByDepartment),
      },
      netOperatingResult: metrics.netOperatingResult,
      restaurantByCategory: rank(restaurantByCategory),
      activity: {
        bookings: metrics.bookingsCount,
        restaurantOrders: metrics.ordersCount,
        conferenceEvents: metrics.eventsCount,
      },
      outstandingPayments: metrics.pendingPayments,
      caveats: [
        "Occupancy and today's arrivals/departures are current values, not period totals.",
        "Net operating result covers only revenue and expenses recorded in InnPilot.",
      ],
    };
  },
};
