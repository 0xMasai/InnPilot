/**
 * Tool input validation — the boundary where model-generated data enters
 * the system.
 *
 * The JSON Schema a tool advertises is documentation the model may ignore
 * or get wrong, and a compromised or confused model can send anything at
 * all. These tests assert the server-side check is what actually holds:
 * malformed values rejected, undeclared arguments (including smuggled
 * tenant ids) refused outright.
 */
import { describe, expect, it } from "vitest";
import { ToolValidationError } from "../../server/ai/types";
import {
  optionalInt,
  parsePeriod,
  strictObject,
} from "../../server/ai/tools/validation";

describe("strictObject", () => {
  it("accepts declared keys and an empty input", () => {
    expect(strictObject({ filter: "Occupied" }, ["filter"])).toEqual({
      filter: "Occupied",
    });
    expect(strictObject(undefined, ["filter"])).toEqual({});
  });

  // Tenant ids are taken from the server-derived ToolContext. A tool that
  // silently ignored a supplied hotelId would still be safe, but rejecting
  // it makes the attempt visible and keeps a future tool from honouring it.
  it("refuses smuggled tenant and identity arguments", () => {
    for (const smuggled of [
      { hotelId: "other-hotel" },
      { propertyId: "other-hotel" },
      { userId: "someone-else" },
      { role: "hotel_admin" },
    ]) {
      expect(() => strictObject(smuggled, ["period"])).toThrow(ToolValidationError);
    }
  });

  it("names the offending keys so a confused model can correct itself", () => {
    expect(() => strictObject({ hotelId: "x", period: "today" }, ["period"])).toThrow(
      /hotelId/
    );
  });

  it("refuses non-objects", () => {
    for (const bad of ["a string", 42, [1, 2, 3], true]) {
      expect(() => strictObject(bad, [])).toThrow(ToolValidationError);
    }
  });
});

describe("parsePeriod", () => {
  it("defaults to today when nothing is supplied", () => {
    expect(parsePeriod({}).range.label).toBe("Today");
  });

  it("accepts the presets the dashboards offer", () => {
    for (const period of ["today", "week", "month", "lastMonth", "all"]) {
      expect(() => parsePeriod({ period })).not.toThrow();
    }
  });

  it("refuses periods it does not define rather than guessing", () => {
    for (const period of ["yesterday", "YTD", " today", "TODAY", "all;drop"]) {
      expect(() => parsePeriod({ period })).toThrow(ToolValidationError);
    }
  });

  // Models routinely send "" or null for an optional field they chose not
  // to use; treating that as "absent" is deliberate, not an oversight.
  it("treats empty and null as not supplied", () => {
    expect(parsePeriod({ period: "" }).range.label).toBe("Today");
    expect(parsePeriod({ period: null }).range.label).toBe("Today");
  });

  it("refuses a half-specified custom range", () => {
    expect(() => parsePeriod({ startDate: "2026-01-01" })).toThrow(/endDate/);
    expect(() => parsePeriod({ endDate: "2026-01-01" })).toThrow(/startDate/);
  });

  it("refuses malformed and impossible dates", () => {
    for (const startDate of [
      "not-a-date",
      "2026-13-01",
      "2026-02-31",
      "01-01-2026",
      "2026-1-1",
    ]) {
      expect(() => parsePeriod({ startDate, endDate: "2026-12-31" })).toThrow(
        ToolValidationError
      );
    }
  });

  it("refuses a reversed range", () => {
    expect(() =>
      parsePeriod({ startDate: "2026-06-01", endDate: "2026-01-01" })
    ).toThrow(/before/);
  });

  it("builds an inclusive custom range", () => {
    const { range } = parsePeriod({ startDate: "2026-03-01", endDate: "2026-03-31" });
    expect(range.start.getMonth()).toBe(2);
    // `end` is exclusive: the 31st is covered, 1 April is not.
    expect(range.end.getTime()).toBeGreaterThan(new Date(2026, 2, 31).getTime());
    expect(range.end.getMonth()).toBe(3);
  });
});

describe("optionalInt", () => {
  it("enforces bounds instead of clamping silently", () => {
    const bounds = { min: 1, max: 50, fallback: 20 };
    expect(optionalInt({}, "limit", bounds)).toBe(20);
    expect(optionalInt({ limit: 10 }, "limit", bounds)).toBe(10);

    // `true` and `[]` are here because Number() would coerce them to 1 and
    // 0 — valid-looking limits the caller never asked for.
    for (const limit of [0, -1, 51, 1e6, 2.5, "many", true, false, [], {}, "10abc"]) {
      expect(() => optionalInt({ limit }, "limit", bounds)).toThrow(
        ToolValidationError
      );
    }

    // Same leniency as the enums: unsupplied means the default.
    expect(optionalInt({ limit: null }, "limit", bounds)).toBe(20);
    expect(optionalInt({ limit: "" }, "limit", bounds)).toBe(20);
    // A digit string is the one non-number shape worth accepting.
    expect(optionalInt({ limit: "15" }, "limit", bounds)).toBe(15);
  });
});
