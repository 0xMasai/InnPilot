/**
 * Role resolution tests (Phase 5, privilege escalation).
 *
 * `coerceRole` is the boundary where a users/{uid} document becomes an
 * authorization decision, so it is the one place a bad or hostile stored
 * value could become access.
 */
import { describe, expect, it } from "vitest";
import { coerceRole } from "../src/ai/contextManager";
import { requireActiveAccount, requireHotelContext } from "../src/ai/permissionGuard";
import { ToolAuthorizationError } from "../src/ai/types";
import { ctxFor } from "./fixtures";

describe("role coercion", () => {
  it("accepts exactly the four known roles", () => {
    for (const role of ["super_admin", "hotel_admin", "staff", "pending"]) {
      expect(coerceRole(role)).toBe(role);
    }
  });

  it.each([
    ["admin", "a role this code does not know"],
    ["hotel_admin ", "trailing whitespace"],
    ["HOTEL_ADMIN", "different case"],
    [undefined, "missing field"],
    [null, "null field"],
    [{ role: "hotel_admin" }, "an object"],
    [["hotel_admin"], "an array"],
    [true, "a boolean"],
    ["", "empty string"],
  ])("coerces %j (%s) to pending, which has no access", (value) => {
    expect(coerceRole(value)).toBe("pending");
  });
});

describe("guard primitives", () => {
  it("refuses pending accounts", () => {
    expect(() => requireActiveAccount(ctxFor("pending"))).toThrow(ToolAuthorizationError);
  });

  it("allows active roles through", () => {
    expect(() => requireActiveAccount(ctxFor("hotel_admin"))).not.toThrow();
    expect(() => requireActiveAccount(ctxFor("staff"))).not.toThrow();
  });

  it("requires a resolved hotel, and returns it unchanged", () => {
    expect(requireHotelContext(ctxFor("hotel_admin", "hotel-a"))).toBe("hotel-a");
    expect(() => requireHotelContext(ctxFor("super_admin"))).toThrow(ToolAuthorizationError);
    expect(() => requireHotelContext({ ...ctxFor("staff"), hotelId: null })).toThrow(
      ToolAuthorizationError
    );
  });
});
