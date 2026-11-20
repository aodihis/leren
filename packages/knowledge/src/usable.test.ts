import { describe, expect, it } from "vitest";

import { isKnowledgeUsable } from "./usable";

const validFrom = new Date("2026-12-01T00:00:00Z");
const validUntil = new Date("2026-12-10T00:00:00Z");

describe("isKnowledgeUsable", () => {
  it.each([
    [
      "a draft item inside its window",
      "draft",
      validFrom,
      validUntil,
      "2026-12-05T00:00:00Z",
      false,
    ],
    ["an archived item inside its window", "archived", null, null, "2026-12-05T00:00:00Z", false],
    [
      "an approved item before its window",
      "approved",
      validFrom,
      validUntil,
      "2026-11-30T23:59:59Z",
      false,
    ],
    [
      "an approved item at the start instant",
      "approved",
      validFrom,
      validUntil,
      "2026-12-01T00:00:00Z",
      true,
    ],
    [
      "an approved item inside its window",
      "approved",
      validFrom,
      validUntil,
      "2026-12-05T00:00:00Z",
      true,
    ],
    [
      "an approved item at the end instant",
      "approved",
      validFrom,
      validUntil,
      "2026-12-10T00:00:00Z",
      true,
    ],
    [
      "an approved item after its window",
      "approved",
      validFrom,
      validUntil,
      "2026-12-10T00:00:01Z",
      false,
    ],
    [
      "an approved item with an open start",
      "approved",
      null,
      validUntil,
      "2000-01-01T00:00:00Z",
      true,
    ],
    [
      "an approved item with an open end",
      "approved",
      validFrom,
      null,
      "2099-01-01T00:00:00Z",
      true,
    ],
    ["an approved item with no bounds", "approved", null, null, "2026-12-05T00:00:00Z", true],
  ] as const)("treats %s as usable: %s", (_name, approvalStatus, from, until, now, expected) => {
    expect(
      isKnowledgeUsable({ approvalStatus, validFrom: from, validUntil: until }, new Date(now)),
    ).toBe(expected);
  });
});
