import { describe, expect, it } from "vitest";

import { getPlaybookStatus, hasNoMailbox } from "./status";

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

describe("hasNoMailbox", () => {
  const ACCOUNT = "7f1b0a5e-1111-4222-8333-444455556666";
  const OTHER = "9c2d1b6f-2222-4333-8444-555566667777";
  const active = new Set([ACCOUNT]);
  const withAccount = { channel: "email", channelAccountId: ACCOUNT };
  const withoutAccount = { channel: "email", channelAccountId: null };
  const revoked = { channel: "email", channelAccountId: OTHER };

  it("flags a playbook that is on and listens without an account", () => {
    expect(hasNoMailbox({ enabled: true, conditions: [withoutAccount] } as never, active)).toBe(
      true,
    );
  });

  it("does not flag a playbook that names an active account", () => {
    expect(hasNoMailbox({ enabled: true, conditions: [withAccount] } as never, active)).toBe(false);
  });

  it("flags a playbook that is on and names an account that is no longer active", () => {
    expect(hasNoMailbox({ enabled: true, conditions: [revoked] } as never, active)).toBe(true);
  });

  it("does not flag a playbook that is off, because it may be saved without an account", () => {
    expect(hasNoMailbox({ enabled: false, conditions: [withoutAccount] } as never, active)).toBe(
      false,
    );
  });

  it("flags only a playbook with no account when the accounts could not be loaded", () => {
    expect(hasNoMailbox({ enabled: true, conditions: [withoutAccount] } as never, null)).toBe(true);
    expect(hasNoMailbox({ enabled: true, conditions: [revoked] } as never, null)).toBe(false);
  });
});
