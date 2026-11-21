import { describe, expect, it } from "vitest";

import { getPlaybookStatus } from "./status";

describe("getPlaybookStatus", () => {
  it.each([
    [true, "active", "active"],
    [true, "scheduled", "scheduled"],
    [true, "expired", "expired"],
    [false, "active", "disabled"],
    [false, "expired", "disabled"],
  ] as const)(
    "shows an enabled=%s playbook with a %s period as %s",
    (enabled, periodStatus, expected) => {
      expect(getPlaybookStatus({ enabled, periodStatus })).toBe(expected);
    },
  );
});
