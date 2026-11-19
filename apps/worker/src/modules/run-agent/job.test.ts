import { describe, expect, it } from "vitest";

import { runAgentJob } from "./job";

describe("runAgentJob", () => {
  const context = {
    jobId: "job-1",
    attempt: 1,
    idempotencyKey: "key-1",
    signal: new AbortController().signal,
  };

  it("is consumed from the run-agent queue", () => {
    expect(runAgentJob.name).toBe("run-agent");
  });

  it("rejects a payload without an agent id", () => {
    expect(runAgentJob.schema.safeParse({ input: 1 }).success).toBe(false);
  });

  it("fails for an agent that is not registered so that the job is retried", async () => {
    await expect(runAgentJob.handler({ agentId: "missing", input: null }, context)).rejects.toThrow(
      "Unknown agent: missing",
    );
  });
});
