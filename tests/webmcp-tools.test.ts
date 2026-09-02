/**
 * Unit tests for the pure parts of the WebMCP layer: argument parsing and
 * the shared availability filter. Firestore-backed paths are covered by
 * the emulator rules tests and the browser harness, not here.
 */
import { describe, expect, it } from "vitest";
import {
  optionalDate,
  optionalEnum,
  optionalString,
  requireDate,
  requireEnum,
  requireString,
  toolError,
  toolText,
} from "../src/webmcp/toolInput";
import { ToolInputError } from "../src/webmcp/types";
import { bookableRooms } from "../src/lib/pms";

describe("WebMCP tool input parsing", () => {
  it("requires non-empty strings and trims them", () => {
    expect(requireString({ a: "  hi  " }, "a")).toBe("hi");
    expect(() => requireString({ a: "   " }, "a")).toThrow(ToolInputError);
    expect(() => requireString({}, "a")).toThrow(ToolInputError);
    expect(() => requireString({ a: 5 }, "a")).toThrow(ToolInputError);
  });

  it("treats blank optional strings as absent", () => {
    expect(optionalString({ a: "" }, "a")).toBeUndefined();
    expect(optionalString({}, "a")).toBeUndefined();
    expect(optionalString({ a: null }, "a")).toBeUndefined();
    expect(optionalString({ a: " x " }, "a")).toBe("x");
    expect(() => optionalString({ a: 1 }, "a")).toThrow(ToolInputError);
  });

  it("accepts only YYYY-MM-DD calendar dates", () => {
    expect(requireDate({ d: "2026-09-01" }, "d")).toBe("2026-09-01");
    expect(() => requireDate({ d: "01/09/2026" }, "d")).toThrow(ToolInputError);
    expect(() => requireDate({ d: "2026-9-1" }, "d")).toThrow(ToolInputError);
    expect(() => requireDate({ d: "2026-13-45" }, "d")).toThrow(ToolInputError);
    expect(optionalDate({}, "d")).toBeUndefined();
  });

  it("matches enums case-insensitively and reports the valid options", () => {
    const allowed = ["Confirmed", "Cancelled"] as const;
    expect(requireEnum({ s: "confirmed" }, "s", allowed)).toBe("Confirmed");
    expect(optionalEnum({}, "s", allowed)).toBeUndefined();
    expect(() => requireEnum({ s: "Nope" }, "s", allowed)).toThrow(/Confirmed, Cancelled/);
  });

  it("marks failures as errors and successes as plain text", () => {
    expect(toolText("ok")).toEqual({ content: [{ type: "text", text: "ok" }] });
    expect(toolError("bad").isError).toBe(true);
  });
});

describe("bookable room filter", () => {
  it("excludes only maintenance and out-of-service rooms", () => {
    const rooms = [
      { number: "101", status: "Available" },
      { number: "102", status: "Occupied" },
      { number: "103", status: "Cleaning" },
      { number: "104", status: "Maintenance" },
      { number: "105", status: "Out of Service" },
    ];
    expect(bookableRooms(rooms).map((r) => r.number)).toEqual(["101", "102", "103"]);
  });
});
