/**
 * The InnPilot WebMCP toolset.
 *
 * registry.ts registers everything in this array for the signed-in
 * session, applying the auth/role/tenant guard to each. Adding a tool
 * means writing it in this directory and listing it here.
 *
 * V1 is READ-ONLY by mandate. The write tools (create reservation, update
 * reservation status, set room status) still exist in ./reservations and
 * ./rooms, but are deliberately NOT registered here: an external browser
 * agent must never perform an autonomous, unconfirmed write. AI writes stay
 * confirmation-gated on the server-side gateway (server/ai/), which is the
 * only surface allowed to change hotel data. Re-list a write tool below only
 * once a WebMCP confirmation protocol equivalent to the gateway's exists.
 *
 * Not yet covered: folio charges and payments. Their Firestore rules and
 * types exist, but InnPilot has no service for either, and inventing
 * money-handling logic is out of scope for the WebMCP integration.
 */
import { checkAvailabilityTool, listRoomsTool } from "./availability";
import { getOccupancyTool, getRevenueTool } from "./reporting";
import { listReservationsTool } from "./reservations";
import type { InnPilotWebMCPTool } from "../types";

export const INNPILOT_WEBMCP_TOOLS: InnPilotWebMCPTool[] = [
  // Read-only surface for external agents (V1). Write tools are intentionally
  // omitted — see the module comment above.
  listRoomsTool,
  listReservationsTool,
  checkAvailabilityTool,
  getOccupancyTool,
  getRevenueTool,
];
