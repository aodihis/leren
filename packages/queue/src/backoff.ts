import type { BackoffPolicy, ConsumeOptions } from "./types";

export const DEFAULT_MAX_ATTEMPTS = 3;

export const DEFAULT_BACKOFF: BackoffPolicy = {
  initialDelayMs: 1_000,
  factor: 2,
  maxDelayMs: 60_000,
};

/**
 * Returns the delay to wait after `failedAttempt` failed, where the first attempt is 1.
 * The result is a whole number of milliseconds, so it can name a retry queue.
 */
export function getBackoffDelayMs(policy: BackoffPolicy, failedAttempt: number): number {
  const delay = policy.initialDelayMs * policy.factor ** (failedAttempt - 1);

  return Math.round(Math.min(delay, policy.maxDelayMs));
}

export type ResolvedConsumeOptions = Required<ConsumeOptions>;

/** Fills the defaults of `ConsumeOptions` and rejects values that could never work. */
export function resolveConsumeOptions(options: ConsumeOptions = {}): ResolvedConsumeOptions {
  const resolved = {
    maxAttempts: options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    backoff: options.backoff ?? DEFAULT_BACKOFF,
    concurrency: options.concurrency ?? 1,
  };

  if (!Number.isInteger(resolved.maxAttempts) || resolved.maxAttempts < 1) {
    throw new RangeError("maxAttempts must be a positive integer");
  }

  if (!Number.isInteger(resolved.concurrency) || resolved.concurrency < 1) {
    throw new RangeError("concurrency must be a positive integer");
  }

  return resolved;
}
