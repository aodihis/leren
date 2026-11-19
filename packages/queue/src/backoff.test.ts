import { describe, expect, it } from "vitest";

import { DEFAULT_BACKOFF, getBackoffDelayMs, resolveConsumeOptions } from "./backoff";

describe("getBackoffDelayMs", () => {
  const policy = { initialDelayMs: 100, factor: 2, maxDelayMs: 500 };

  it("grows by the factor after each failed attempt", () => {
    expect([1, 2, 3].map((attempt) => getBackoffDelayMs(policy, attempt))).toEqual([100, 200, 400]);
  });

  it("never exceeds the maximum delay", () => {
    expect(getBackoffDelayMs(policy, 10)).toBe(500);
  });

  it("returns a whole number of milliseconds", () => {
    expect(getBackoffDelayMs({ ...policy, factor: 1.5 }, 2)).toBe(150);
    expect(Number.isInteger(getBackoffDelayMs({ ...policy, factor: 1.337 }, 3))).toBe(true);
  });
});

describe("resolveConsumeOptions", () => {
  it("fills the defaults", () => {
    expect(resolveConsumeOptions()).toEqual({
      maxAttempts: 3,
      backoff: DEFAULT_BACKOFF,
      concurrency: 1,
    });
  });

  it("rejects an attempt count below one", () => {
    expect(() => resolveConsumeOptions({ maxAttempts: 0 })).toThrow(RangeError);
  });

  it("rejects a concurrency that is not a positive integer", () => {
    expect(() => resolveConsumeOptions({ concurrency: 1.5 })).toThrow(RangeError);
  });
});
