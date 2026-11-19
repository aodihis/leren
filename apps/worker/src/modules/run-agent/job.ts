import { defineJob } from "../../job";
import { runAgentPayloadSchema } from "./schema";
import { createAgentRegistry, runAgent } from "./service";

const agentRegistry = createAgentRegistry([]);

export const runAgentJob = defineJob({
  name: "run-agent",
  schema: runAgentPayloadSchema,
  maxAttempts: 2,
  async handler(payload, context) {
    const result = await runAgent(agentRegistry, payload, { signal: context.signal });

    console.log(`[run-agent] ${payload.agentId} finished`, result.output);
  },
});
