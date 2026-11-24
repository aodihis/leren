import { getBackoffDelayMs } from "./backoff";
import type { ResolvedConsumeOptions } from "./backoff";
import { NonRetryableError } from "./errors";

export type FailurePlan = { kind: "retry"; delayMs: number } | { kind: "dead-letter" };

/** Decides what happens to a failed message. */
export function planFailure(
  error: unknown,
  attempt: number,
  options: ResolvedConsumeOptions,
): FailurePlan {
  if (error instanceof NonRetryableError || attempt >= options.maxAttempts) {
    return { kind: "dead-letter" };
  }

  return { kind: "retry", delayMs: getBackoffDelayMs(options.backoff, attempt) };
}
