/**
 * Permission Guard — the authorization boundary for tool calls.
 *
 * The guard exists because the Admin SDK bypasses firestore.rules
 * entirely: on the server nothing else stands between a model asking for
 * data and Firestore handing it over. These tests assert it mirrors the
 * rules' own role model (see firestore.rules `hotelStaff`/`hotelAdmin`)
 * for every role, including the ones nobody expects to send a request.
 */
import { describe, expect, it } from "vitest";
import {
  assertCanCallTool,
  requireActiveAccount,
  requireHotelContext,
} from "../../server/ai/permissionGuard";
import { ToolAuthorizationError } from "../../server/ai/types";
import type { Role, ToolContext, ToolDefinition } from "../../server/ai/types";

const HOTEL_A = "hotel-a";

function ctx(role: Role, hotelId: string | null = HOTEL_A): ToolContext {
  return {
    userId: `uid-${role}`,
    userEmail: `${role}@example.com`,
    role,
    hotelId,
    conversationId: "conv-1",
  };
}

const readTool: ToolDefinition = {
  name: "test_read",
  description: "test",
  allowedRoles: ["hotel_admin", "staff"],
  inputSchema: { type: "object", properties: {} },
  isWrite: false,
  validateInput: () => ({}),
  handler: async () => ({}),
};

/** Stands in for a future admin-only tool (e.g. anything audit-log shaped). */
const adminOnlyTool: ToolDefinition = {
  ...readTool,
  name: "test_admin_only",
  allowedRoles: ["hotel_admin"],
};

describe("requireActiveAccount", () => {
  it("refuses pending accounts", () => {
    expect(() => requireActiveAccount(ctx("pending", null))).toThrow(
      ToolAuthorizationError
    );
  });

  it("allows accounts linked to a hotel", () => {
    expect(() => requireActiveAccount(ctx("staff"))).not.toThrow();
    expect(() => requireActiveAccount(ctx("hotel_admin"))).not.toThrow();
  });
});

describe("requireHotelContext", () => {
  it("returns the hotel from context, never an argument", () => {
    expect(requireHotelContext(ctx("staff"))).toBe(HOTEL_A);
  });

  it("refuses a hotel_admin whose account has no hotel", () => {
    expect(() => requireHotelContext(ctx("hotel_admin", null))).toThrow(
      ToolAuthorizationError
    );
  });

  it("refuses super_admin, which has no hotel by definition", () => {
    expect(() => requireHotelContext(ctx("super_admin", null))).toThrow(
      ToolAuthorizationError
    );
  });
});

describe("assertCanCallTool", () => {
  it("allows the roles firestore.rules grants read access to", () => {
    expect(() => assertCanCallTool(ctx("hotel_admin"), readTool)).not.toThrow();
    expect(() => assertCanCallTool(ctx("staff"), readTool)).not.toThrow();
  });

  it("refuses a pending account before considering the tool", () => {
    expect(() => assertCanCallTool(ctx("pending", null), readTool)).toThrow(
      /not yet linked to a hotel/i
    );
  });

  it("refuses super_admin: every V1 tool is hotel-scoped", () => {
    expect(() => assertCanCallTool(ctx("super_admin", null), readTool)).toThrow(
      ToolAuthorizationError
    );
  });

  // Privilege escalation: role comes from users/{uid}, never from the
  // model or the request, so a staff member cannot reach an admin tool.
  it("refuses staff on an admin-only tool", () => {
    expect(() => assertCanCallTool(ctx("staff"), adminOnlyTool)).toThrow(
      /not permitted/i
    );
    expect(() => assertCanCallTool(ctx("hotel_admin"), adminOnlyTool)).not.toThrow();
  });

  it("refuses a staff account with no hotel, even for a permitted tool", () => {
    expect(() => assertCanCallTool(ctx("staff", null), readTool)).toThrow(
      ToolAuthorizationError
    );
  });

  it("refuses an unknown role rather than defaulting to allowed", () => {
    const rogue = { ...ctx("staff"), role: "owner" as unknown as Role };
    expect(() => assertCanCallTool(rogue, readTool)).toThrow(ToolAuthorizationError);
  });
});
