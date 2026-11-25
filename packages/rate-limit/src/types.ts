/** How many calls a key may make in a window, and how long the window lasts. */
export type RateLimitRule = {
  limit: number;
  windowSeconds: number;
};

export type RateLimitResult = {
  allowed: boolean;
  /** How many more calls the key may make in the current window. */
  remaining: number;
  /** How long until the current window ends, in seconds. It is at least 1. */
  retryAfterSeconds: number;
};

/**
 * Counts calls for a key. Each window starts with the first call for the key, lasts
 * `windowSeconds` and then resets, so a caller can make up to twice the limit across the boundary
 * of two windows. A call that is over the limit is still counted, and that never extends the window.
 */
export type RateLimiter = {
  consume(key: string, rule: RateLimitRule): Promise<RateLimitResult>;
  close(): Promise<void>;
};
