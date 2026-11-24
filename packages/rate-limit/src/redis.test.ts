import { describeRateLimiterContract } from "./contract";
import { createRedisRateLimiter } from "./redis";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:56379";

describeRateLimiterContract(
  "Redis",
  () => createRedisRateLimiter({ url: REDIS_URL, prefix: "test" }),
  async (seconds) => {
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  },
);
