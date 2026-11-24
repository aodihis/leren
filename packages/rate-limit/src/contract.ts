import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { RateLimiter } from "./types";

/**
 * The behaviour that every limiter must have, so the in-memory and Redis limiters are held to one
 * definition. `advance` moves the clock of the limiter by the given seconds.
 */
export function describeRateLimiterContract(
  name: string,
  create: () => RateLimiter,
  advance: (seconds: number) => Promise<void>,
) {
  describe(`${name} rate limiter`, () => {
    const rule = { limit: 3, windowSeconds: 1 };

    it("allows calls up to the limit and refuses the next", async () => {
      const limiter = create();
      const key = randomUUID();

      const results = [];

      for (let call = 0; call < 4; call += 1) {
        results.push(await limiter.consume(key, rule));
      }

      expect(results.map((result) => result.allowed)).toEqual([true, true, true, false]);
      expect(results.map((result) => result.remaining)).toEqual([2, 1, 0, 0]);
      expect(results[3]?.retryAfterSeconds).toBeGreaterThanOrEqual(1);
      expect(results[3]?.retryAfterSeconds).toBeLessThanOrEqual(1);
      await limiter.close();
    });

    it("counts each key on its own", async () => {
      const limiter = create();
      const [first, second] = [randomUUID(), randomUUID()];

      for (let call = 0; call < 4; call += 1) {
        await limiter.consume(first, rule);
      }

      expect((await limiter.consume(second, rule)).allowed).toBe(true);
      await limiter.close();
    });

    it("allows calls again after the window ends", async () => {
      const limiter = create();
      const key = randomUUID();

      for (let call = 0; call < 4; call += 1) {
        await limiter.consume(key, rule);
      }

      await advance(1.1);

      expect((await limiter.consume(key, rule)).allowed).toBe(true);
      await limiter.close();
    });
  });
}
