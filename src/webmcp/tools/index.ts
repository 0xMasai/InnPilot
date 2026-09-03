/**
 * The InnPilot WebMCP toolset.
 *
 * registry.ts registers everything in this array for the signed-in
 * session, applying the auth/role/tenant guard to each. Adding a tool
 * means writing it in this directory and listing it here.
 *
 * V1 registers all eight tools — five read and three write. Each write runs
 * the same validated service the UI uses and is recorded in the audit log as
 * an agent action; the auth/role/tenant guard re-checks every call. For a
 * stricter posture, drop the three write tools from this array to make the
 * WebMCP surface read-only.
 *
 * Not yet covered: folio charges and payments. Their Firestore rules and
 * types exist, but InnPilot has no service for either, and inventing
 * money-handling logic is out of scope for the WebMCP integration.
 */
import { checkAvailabilityTool, listRoomsTool } from "./availability";
import { getOccupancyTool, getRevenueTool } from "./reporting";
import {
  createReservationTool,
  listReservationsTool,
  updateReservationStatusTool,
} from "./reservations";
import { setRoomStatusTool } from "./rooms";
import type { InnPilotWebMCPTool } from "../types";

export const INNPILOT_WEBMCP_TOOLS: InnPilotWebMCPTool[] = [
  // Read
  listRoomsTool,
  listReservationsTool,
  checkAvailabilityTool,
  getOccupancyTool,
  getRevenueTool,
  // Write (agent-initiated, audited; guarded by role + tenant on every call)
  createReservationTool,
  updateReservationStatusTool,
  setRoomStatusTool,
];
