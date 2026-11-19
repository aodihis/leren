import { describe, expect, it, vi } from "vitest";

import { createAgentRegistry, runAgent } from "./service";

describe("runAgent", () => {
  const signal = new AbortController().signal;

  it("runs the agent named by the payload and returns its result", async () => {
    const run = vi.fn().mockResolvedValue({ output: "done" });
    const registry = createAgentRegistry([{ id: "summarizer", run }]);
    const payload = { agentId: "summarizer", input: { text: "hello" } };

    const result = await runAgent(registry, payload, { signal });

    expect(result).toEqual({ output: "done" });
    expect(run).toHaveBeenCalledWith(payload, { signal });
  });

  it("throws for an agent id that is not registered", async () => {
    const registry = createAgentRegistry([]);

    await expect(
      runAgent(registry, { agentId: "missing", input: null }, { signal }),
    ).rejects.toThrow("Unknown agent: missing");
  });
});
