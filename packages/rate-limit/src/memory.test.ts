import { describeRateLimiterContract } from "./contract";
import { createMemoryRateLimiter } from "./memory";

const clock = { now: 0 };

describeRateLimiterContract(
  "Memory",
  () => createMemoryRateLimiter(() => clock.now),
  async (seconds) => void (clock.now += seconds * 1000),
);
