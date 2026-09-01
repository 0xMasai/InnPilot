/**
 * Read-only tool registration (Phase 4).
 *
 * Importing this module populates the Tool Registry. `index.ts` imports it
 * once at cold start, so the registry is filled before any request is
 * handled — and the system prompt, which renders the registry, always
 * describes exactly the tools that exist.
 *
 * Deliberately absent (see docs/ai/PHASE_1_PLAN.md): housekeeping and
 * maintenance tools. `housekeepingTasks`, `maintenanceRequests` and
 * `nightAudits` are declared in `src/lib/collections.ts` but have no page,
 * no model, and no data anywhere in the app — a tool over them would have
 * to invent a data model, which is exactly what "never fabricate data"
 * forbids. They become a fast-follow once those features exist.
 *
 * Every tool here is read-only. Write tools arrive in Phase 10, behind the
 * Confirmation Manager.
 */
import { registerTool } from "../toolRegistry";
import type { AnyToolDefinition } from "../types";
import {
  getConferenceRevenue,
  getExpenses,
  getOccupancy,
  getRestaurantSales,
  getRevenue,
} from "./read/financials";
import {
  getCheckIns,
  getCheckOuts,
  getInHouseGuests,
  getRoomStatus,
} from "./read/frontDesk";
import { getReservations, getUpcomingReservations } from "./read/reservations";
import {
  generateDailyReport,
  generateMonthlyReport,
  generateWeeklyReport,
} from "./read/reports";

export const READ_TOOLS: AnyToolDefinition[] = [
  // Money and occupancy
  getOccupancy,
  getRevenue,
  getExpenses,
  getRestaurantSales,
  getConferenceRevenue,
  // Front desk and rooms
  getRoomStatus,
  getCheckIns,
  getCheckOuts,
  getInHouseGuests,
  // Reservations
  getReservations,
  getUpcomingReservations,
  // Reports
  generateDailyReport,
  generateWeeklyReport,
  generateMonthlyReport,
];

let registered = false;

/** Idempotent: the registry rejects duplicate names, and tests re-import. */
export function registerReadTools(): void {
  if (registered) return;
  for (const tool of READ_TOOLS) registerTool(tool);
  registered = true;
}
