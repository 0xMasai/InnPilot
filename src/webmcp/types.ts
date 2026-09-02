/**
 * The InnPilot WebMCP tool contract.
 *
 * Tools live in ./tools and are aggregated by ./tools/index.ts. Every one
 * of them inherits the auth/role/tenant guard in ./registry.ts, and must
 * call InnPilot's existing services rather than re-implementing business
 * rules or touching Firestore directly.
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

/**
 * Raised by input helpers when an agent supplies bad arguments. The
 * registry returns its message to the agent verbatim, so the agent can
 * correct the call rather than seeing a wrapped internal error.
 */
export class ToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolInputError";
  }
}
