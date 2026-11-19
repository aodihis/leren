import { describe, expect, it } from "vitest";

import { resolveConsumeOptions } from "./backoff";
import { NonRetryableError } from "./errors";
import { planFailure } from "./retry";

const options = resolveConsumeOptions({
  maxAttempts: 3,
  backoff: { initialDelayMs: 100, factor: 2, maxDelayMs: 1_000 },
});

describe("planFailure", () => {
  it("retries after the backoff delay while attempts remain", () => {
    expect(planFailure(new Error("x"), 1, options)).toEqual({ kind: "retry", delayMs: 100 });
    expect(planFailure(new Error("x"), 2, options)).toEqual({ kind: "retry", delayMs: 200 });
  });

  it("dead-letters on the last attempt", () => {
    expect(planFailure(new Error("x"), 3, options)).toEqual({ kind: "dead-letter" });
  });

  it("dead-letters a non-retryable error on the first attempt", () => {
    expect(planFailure(new NonRetryableError("x"), 1, options)).toEqual({ kind: "dead-letter" });
  });
});
