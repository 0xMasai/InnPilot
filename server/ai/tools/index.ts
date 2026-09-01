/**
 * Tool registration.
 *
 * The single place that decides which tools exist. Phase 4 registers
 * read-only tools; write tools (Phase 10) will register here too, and the
 * Confirmation Manager — not this file — is what gates them.
 *
 * Idempotent, because the registry rejects duplicate names and a warm
 * serverless container may call this on every request.
 */
import { listTools, registerTool } from "../toolRegistry";
import { getOccupancy, getRoomStatus } from "./read/rooms";
import {
  getConferenceRevenue,
  getExpenses,
  getRestaurantSales,
  getRevenue,
} from "./read/finance";
import { getCheckIns, getCheckOuts, getReservations } from "./read/frontDesk";
import { generateReport } from "./read/report";

const READ_TOOLS = [
  getOccupancy,
  getRoomStatus,
  getCheckIns,
  getCheckOuts,
  getReservations,
  getRevenue,
  getExpenses,
  getRestaurantSales,
  getConferenceRevenue,
  generateReport,
];

export function registerReadTools(): void {
  if (listTools().length > 0) return;
  for (const tool of READ_TOOLS) registerTool(tool);
}
