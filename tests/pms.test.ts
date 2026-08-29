import { describe, expect, it } from "vitest";
import { bookingOverlaps, bookingDays, occupancyRate } from "../src/lib/pms";

describe("PMS domain rules", () => {
  it("detects overlapping active reservations for the same room", () => {
    const conflict = bookingOverlaps("101", new Date("2026-08-12T14:00:00"), new Date("2026-08-14T11:00:00"), [
      { roomNumber: "101", guestName: "Alice", status: "Confirmed", checkIn: new Date("2026-08-10"), checkOut: new Date("2026-08-13") },
    ]);
    expect(conflict?.guestName).toBe("Alice");
  });

  it("allows adjacent stays without treating checkout as an overlap", () => {
    const conflict = bookingOverlaps("101", new Date("2026-08-14T14:00:00"), new Date("2026-08-16T11:00:00"), [
      { roomNumber: "101", status: "Confirmed", checkIn: new Date("2026-08-12T14:00:00"), checkOut: new Date("2026-08-14T11:00:00") },
    ]);
    expect(conflict).toBeUndefined();
  });

  it("ignores cancelled and no-show bookings when checking availability", () => {
    const conflict = bookingOverlaps("101", new Date("2026-08-12"), new Date("2026-08-14"), [
      { roomNumber: "101", status: "Cancelled", checkIn: new Date("2026-08-12"), checkOut: new Date("2026-08-14") },
      { roomNumber: "101", status: "No Show", checkIn: new Date("2026-08-12"), checkOut: new Date("2026-08-14") },
    ]);
    expect(conflict).toBeUndefined();
  });

  it("calculates at least one night for a valid stay", () => {
    expect(bookingDays(new Date("2026-08-12T14:00:00"), new Date("2026-08-13T11:00:00"))).toBe(1);
    expect(bookingDays(new Date("2026-08-12"), new Date("2026-08-15"))).toBe(3);
  });

  it("calculates occupancy safely", () => {
    expect(occupancyRate(8, 10)).toBe(80);
    expect(occupancyRate(0, 0)).toBe(0);
  });
});
