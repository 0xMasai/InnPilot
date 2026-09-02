/**
 * The InnPilot WebMCP toolset.
 *
 * registry.ts registers everything in this array for the signed-in
 * session, applying the auth/role/tenant guard to each. Adding a tool
 * means writing it in this directory and listing it here.
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
  // Write
  createReservationTool,
  updateReservationStatusTool,
  setRoomStatusTool,
];
