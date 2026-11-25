import type { RateLimitResult, RateLimitRule, RateLimiter } from "./types";

/**
 * Creates a limiter that keeps its counters in the process. It follows the same rules as the Redis
 * limiter, and it is meant for tests, which pass `now` to move time.
 */
export function createMemoryRateLimiter(now: () => number = Date.now): RateLimiter {
  const windows = new Map<string, { count: number; endsAt: number }>();

  return {
    async consume(key: string, rule: RateLimitRule): Promise<RateLimitResult> {
      const current = now();
      const existing = windows.get(key);

      const window =
        existing && existing.endsAt > current
          ? existing
          : { count: 0, endsAt: current + rule.windowSeconds * 1000 };

      window.count += 1;
      windows.set(key, window);

      return {
        allowed: window.count <= rule.limit,
        remaining: Math.max(0, rule.limit - window.count),
        retryAfterSeconds: Math.max(1, Math.ceil((window.endsAt - current) / 1000)),
      };
    },
    async close() {
      windows.clear();
    },
  };
}
