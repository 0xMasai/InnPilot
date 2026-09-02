/**
 * Tool registration.
 *
 * The single place that decides which tools exist. Phase 4 registered the
 * read-only tools; Phase 10 adds write tools, which the Confirmation
 * Manager — not this file — is what gates.
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
import { updateRoomStatus } from "./write/rooms";
import { updateReservationStatus } from "./write/reservations";

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

/**
 * Every tool here changes data and therefore must declare `isWrite: true`
 * and provide `summarize`. The orchestrator refuses to run a write tool
 * that lacks a summary rather than executing one it cannot describe, so a
 * tool added without one fails closed.
 *
 * Deliberately absent: anything destructive. No tool deletes a booking, a
 * guest, an expense, a user or a hotel — Phase 11's rule, and the reason
 * these two only ever change a status field on a record that already
 * exists.
 */
const WRITE_TOOLS = [updateRoomStatus, updateReservationStatus];

export function registerTools(): void {
  if (listTools().length > 0) return;
  for (const tool of READ_TOOLS) registerTool(tool);
  for (const tool of WRITE_TOOLS) registerTool(tool);
}
