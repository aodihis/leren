import { describe, expect, it } from "vitest";

import { getPlaybookStatus } from "./status";

describe("getPlaybookStatus", () => {
  it.each([
    ["draft", "active", "draft"],
    ["archived", "active", "archived"],
    ["approved", "active", "active"],
    ["approved", "scheduled", "scheduled"],
    ["approved", "expired", "expired"],
    ["draft", "expired", "draft"],
  ] as const)(
    "shows a %s playbook with a %s period as %s",
    (approvalStatus, periodStatus, expected) => {
      expect(getPlaybookStatus({ approvalStatus, periodStatus })).toBe(expected);
    },
  );
});
