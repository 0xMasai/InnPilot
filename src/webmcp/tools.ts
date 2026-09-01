/**
 * The InnPilot WebMCP toolset.
 *
 * Empty by design in Phase 1: the foundation is being landed without
 * exposing any business capability to agents yet. Phase 2 adds tools to
 * INNPILOT_WEBMCP_TOOLS and nowhere else — registry.ts picks them up with
 * no further changes, and every one of them inherits the auth/role/tenant
 * guard automatically.
 *
 * Phase 2 tools must call InnPilot's existing services rather than
 * re-implementing rules or touching Firestore directly. See
 * docs/webmcp/PHASE_1_FOUNDATION.md for the per-capability mapping of
 * which functions to reuse.
 */
import type { Role } from "../types/models";

/** The InnPilot user an agent is acting on behalf of. */
export interface WebMCPAuthContext {
  uid: string;
  email: string | null;
  role: Role;
  /** null for super_admin, who operates the platform rather than a hotel. */
  hotelId: string | null;
}

/** Context handed to a tool after the registry's guard has passed. */
export interface WebMCPToolContext {
  /** The signed-in InnPilot user the agent is acting on behalf of. */
  auth: WebMCPAuthContext;
  /**
   * Tenant to operate in. Guaranteed non-null: the guard rejects the call
   * when the signed-in account has no hotel assigned. Pass this to
   * hotelCollection()/hotelDoc() from src/lib/hotelScope.ts.
   */
  hotelId: string;
}

export interface InnPilotWebMCPTool {
  /** Unique, agent-facing tool name, e.g. "innpilot_get_occupancy". */
  name: string;
  /** Natural-language description the agent uses to decide when to call. */
  description: string;
  /** JSON Schema for the tool's arguments. */
  inputSchema: WebMCPInputSchema;
  /**
   * Roles allowed to invoke this tool. Defaults to ["hotel_admin", "staff"],
   * matching ProtectedRoute, so agents can never exceed the UI's own RBAC.
   */
  allowedRoles?: Role[];
  execute(
    input: Record<string, unknown>,
    context: WebMCPToolContext
  ): Promise<WebMCPToolResult> | WebMCPToolResult;
}

/** Phase 2 populates this array. Phase 1 ships it empty on purpose. */
export const INNPILOT_WEBMCP_TOOLS: InnPilotWebMCPTool[] = [];
