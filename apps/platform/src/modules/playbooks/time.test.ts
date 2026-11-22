import { describe, expect, it } from "vitest";

import { isoToZonedLocal, zonedLocalToIso } from "./time";

describe("zonedLocalToIso", () => {
  it.each([
    ["Asia/Jakarta", "2026-12-01T09:00", "2026-12-01T02:00:00.000Z"],
    ["UTC", "2026-12-01T09:00", "2026-12-01T09:00:00.000Z"],
    ["America/New_York", "2026-01-15T09:00", "2026-01-15T14:00:00.000Z"],
    ["America/New_York", "2026-07-15T09:00", "2026-07-15T13:00:00.000Z"],
    ["Pacific/Auckland", "2026-12-01T09:00", "2026-11-30T20:00:00.000Z"],
  ])("reads %s wall clock %s as the instant %s", (timeZone, local, expected) => {
    expect(zonedLocalToIso(local, timeZone)).toBe(expected);
  });

  it("gives null for an empty value", () => {
    expect(zonedLocalToIso("", "UTC")).toBeNull();
  });
});

describe("isoToZonedLocal", () => {
  it("shows the wall clock time in the zone", () => {
    expect(isoToZonedLocal("2026-12-01T02:00:00.000Z", "Asia/Jakarta")).toBe("2026-12-01T09:00");
  });

  it("gives an empty string for an open bound", () => {
    expect(isoToZonedLocal(null, "UTC")).toBe("");
  });

  it("round-trips through zonedLocalToIso, including across a daylight saving change", () => {
    const local = "2026-03-08T03:30";
    const iso = zonedLocalToIso(local, "America/New_York");

    expect(isoToZonedLocal(iso, "America/New_York")).toBe(local);
  });
});
