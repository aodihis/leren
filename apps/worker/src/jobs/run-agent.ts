import { z } from "zod";
import { agentRegistry } from "../agents/registry.js";
import { defineJob } from "./types.js";

export const runAgentJob = defineJob({
  name: "run-agent",
  schema: z.object({ agentId: z.string(), input: z.unknown() }),
  maxAttempts: 2,
  async handler({ agentId, input }, ctx) {
    const agent = agentRegistry.get(agentId);

    if (!agent) throw new Error(`Unknown agent: ${agentId}`);
    const result = await agent.run({ agentId, input }, { signal: ctx.signal });
    console.log(`[run-agent] ${agentId} finished`, result.output);
  },
});
