/**
 * Occupancy and revenue tools.
 *
 * Both derive their numbers from computeMetrics() in src/lib/metrics.ts —
 * the same function the Overview and Reports dashboards use — so an agent
 * and the UI can never disagree about a figure.
 */
import { computeMetrics, customRange, getRange, type DatePreset } from "../../lib/metrics";
import { loadMetricsInput } from "../../lib/reportingData";
import { money } from "../../lib/pms";
import { optionalDate, optionalEnum, toolError, toolText } from "../toolInput";
import { ToolInputError, type InnPilotWebMCPTool, type WebMCPToolContext } from "../types";

const PRESETS: readonly DatePreset[] = ["today", "week", "month", "lastMonth", "all"];

const rangeSchemaProperties = {
  period: {
    type: "string",
    enum: [...PRESETS],
    description: "Reporting period. Defaults to 'today'. Ignored when startDate/endDate are given.",
  },
  startDate: {
    type: "string",
    description: "Start of a custom range (YYYY-MM-DD). Must be paired with endDate.",
  },
  endDate: {
    type: "string",
    description: "End of a custom range, inclusive (YYYY-MM-DD). Must be paired with startDate.",
  },
} as const;

/** Resolves either an explicit custom range or a named preset. */
function resolveRange(input: Record<string, unknown>) {
  const startDate = optionalDate(input, "startDate");
  const endDate = optionalDate(input, "endDate");

  if (startDate && endDate) {
    const start = new Date(`${startDate}T00:00:00`);
    const end = new Date(`${endDate}T00:00:00`);
    if (end < start) throw new ToolInputError("endDate must be on or after startDate.");
    return { range: customRange(start, end), label: `${startDate} to ${endDate}` };
  }
  if (startDate || endDate) {
    throw new ToolInputError("startDate and endDate must be provided together.");
  }

  const preset = optionalEnum(input, "period", PRESETS) ?? "today";
  return { range: getRange(preset), label: preset };
}

export const getOccupancyTool: InnPilotWebMCPTool = {
  name: "innpilot_get_occupancy",
  description:
    "Get room occupancy for this hotel: total rooms, how many are occupied and available, and the occupancy rate as a percentage. Use for questions like 'how full are we today?'.",
  inputSchema: {
    type: "object",
    properties: rangeSchemaProperties,
    additionalProperties: false,
  },
  async execute(input: Record<string, unknown>, context: WebMCPToolContext) {
    const { range, label } = resolveRange(input);
    const metrics = computeMetrics(await loadMetricsInput(context.hotelId), range);
    const { totalRooms, occupied, available, rate } = metrics.occupancy;

    if (totalRooms === 0) {
      return toolError("This hotel has no rooms registered, so occupancy cannot be calculated.");
    }

    return toolText(
      [
        `Occupancy (${label}):`,
        `- Occupancy rate: ${rate === null ? "n/a" : `${rate}%`}`,
        `- Occupied rooms: ${occupied} of ${totalRooms}`,
        `- Available rooms: ${available}`,
      ].join("\n")
    );
  },
};

export const getRevenueTool: InnPilotWebMCPTool = {
  name: "innpilot_get_revenue",
  description:
    "Get revenue for this hotel broken down by department (accommodation, restaurant, conference), plus recorded expenses, net operating result and outstanding payments. Use for questions about takings, sales or financial performance.",
  inputSchema: {
    type: "object",
    properties: rangeSchemaProperties,
    additionalProperties: false,
  },
  async execute(input: Record<string, unknown>, context: WebMCPToolContext) {
    const { range, label } = resolveRange(input);
    const m = computeMetrics(await loadMetricsInput(context.hotelId), range);

    return toolText(
      [
        `Revenue (${label}):`,
        `- Accommodation: ${money(m.accommodationRevenue)}`,
        `- Restaurant: ${money(m.restaurantRevenue)}`,
        `- Conference: ${money(m.conferenceRevenue)}`,
        `- Total revenue: ${money(m.totalRevenue)}`,
        `- Recorded expenses: ${money(m.totalExpenses)}`,
        `- Net operating result: ${money(m.netOperatingResult)}`,
        `- Outstanding payments: ${m.pendingPayments.count} booking(s), ${money(m.pendingPayments.amount)}`,
        `Counts: ${m.bookingsCount} booking(s), ${m.ordersCount} order(s), ${m.eventsCount} event(s).`,
        "Net operating result reflects only revenue and expenses recorded in InnPilot; it is not audited profit.",
      ].join("\n")
    );
  },
};
