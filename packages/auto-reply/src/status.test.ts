import { describe, expect, it } from "vitest";

import { getAutoReplyStatus } from "./status";

const startsAt = new Date("2026-12-01T00:00:00Z");
const endsAt = new Date("2026-12-10T00:00:00Z");

describe("getAutoReplyStatus", () => {
  it.each([
    ["is scheduled before the start", startsAt, endsAt, "2026-11-30T23:59:59Z", "scheduled"],
    ["is active at the start instant", startsAt, endsAt, "2026-12-01T00:00:00Z", "active"],
    ["is active inside the window", startsAt, endsAt, "2026-12-05T00:00:00Z", "active"],
    ["is active at the end instant", startsAt, endsAt, "2026-12-10T00:00:00Z", "active"],
    ["is expired after the end", startsAt, endsAt, "2026-12-10T00:00:01Z", "expired"],
    ["is active with an open start", null, endsAt, "2000-01-01T00:00:00Z", "active"],
    ["is active with an open end", startsAt, null, "2099-01-01T00:00:00Z", "active"],
    ["is active with both bounds open", null, null, "2026-12-05T00:00:00Z", "active"],
    [
      "is expired with an open start once the end has passed",
      null,
      endsAt,
      "2027-01-01T00:00:00Z",
      "expired",
    ],
  ] as const)("%s", (_name, start, end, now, expected) => {
    expect(getAutoReplyStatus({ startsAt: start, endsAt: end }, new Date(now))).toBe(expected);
  });
});
