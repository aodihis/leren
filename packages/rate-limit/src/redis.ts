import { Redis } from "ioredis";

import type { RateLimitResult, RateLimitRule, RateLimiter } from "./types";

/**
 * Increments the counter and sets its expiry in one step, so a crash between the two can never
 * leave a counter that does not expire. Returns the count and the milliseconds left in the window.
 */
const CONSUME_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if count == 1 or ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return { count, ttl }
`;

export type RedisRateLimiterOptions = {
  url: string;
  /** Prefixes every key, so the limiter does not collide with other uses of the same Redis. */
  prefix?: string;
};

/** Creates a limiter whose counters live in Redis, so every API process shares them. */
export function createRedisRateLimiter({
  url,
  prefix = "rate-limit",
}: RedisRateLimiterOptions): RateLimiter {
  const redis = new Redis(url, { maxRetriesPerRequest: 1, commandTimeout: 1000 });

  redis.on("error", () => undefined);

  return {
    async consume(key: string, rule: RateLimitRule): Promise<RateLimitResult> {
      const [count, ttlMilliseconds] = (await redis.eval(
        CONSUME_SCRIPT,
        1,
        `${prefix}:${key}`,
        rule.windowSeconds * 1000,
      )) as [number, number];

      return {
        allowed: count <= rule.limit,
        remaining: Math.max(0, rule.limit - count),
        retryAfterSeconds: Math.max(1, Math.ceil(ttlMilliseconds / 1000)),
      };
    },
    async close() {
      await redis.quit();
    },
  };
}
