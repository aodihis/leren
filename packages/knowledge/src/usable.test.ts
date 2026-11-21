import { describe, expect, it } from "vitest";

import { isKnowledgeUsable } from "./usable";

const startsAt = new Date("2026-12-01T00:00:00Z");
const endsAt = new Date("2026-12-10T00:00:00Z");

describe("isKnowledgeUsable", () => {
  it.each([
    ["a disabled item inside its window", false, startsAt, endsAt, "2026-12-05T00:00:00Z", false],
    ["a disabled item inside its window", false, null, null, "2026-12-05T00:00:00Z", false],
    ["an enabled item before its window", true, startsAt, endsAt, "2026-11-30T23:59:59Z", false],
    ["an enabled item at the start instant", true, startsAt, endsAt, "2026-12-01T00:00:00Z", true],
    ["an enabled item inside its window", true, startsAt, endsAt, "2026-12-05T00:00:00Z", true],
    ["an enabled item at the end instant", true, startsAt, endsAt, "2026-12-10T00:00:00Z", true],
    ["an enabled item after its window", true, startsAt, endsAt, "2026-12-10T00:00:01Z", false],
    ["an enabled item with an open start", true, null, endsAt, "2000-01-01T00:00:00Z", true],
    ["an enabled item with an open end", true, startsAt, null, "2099-01-01T00:00:00Z", true],
    ["an enabled item with no bounds", true, null, null, "2026-12-05T00:00:00Z", true],
  ] as const)("treats %s as usable: %s", (_name, enabled, from, until, now, expected) => {
    expect(isKnowledgeUsable({ enabled, startsAt: from, endsAt: until }, new Date(now))).toBe(
      expected,
    );
  });
});
