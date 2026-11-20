import { defineJob } from "../../job";
import { logger } from "../../logger";
import { runAgentPayloadSchema } from "./schema";
import { createAgentRegistry, runAgent } from "./service";

const agentRegistry = createAgentRegistry([]);

export const runAgentJob = defineJob({
  name: "run-agent",
  schema: runAgentPayloadSchema,
  maxAttempts: 2,
  async handler(payload, context) {
    const result = await runAgent(agentRegistry, payload, { signal: context.signal });

    logger
      .child({ job: "run-agent", jobId: context.jobId })
      .info("Agent finished", { agentId: payload.agentId, output: result.output });
  },
});
