import { z } from "zod";

export const runAgentPayloadSchema = z.object({
  agentId: z.string(),
  input: z.unknown(),
});

export type RunAgentPayload = z.infer<typeof runAgentPayloadSchema>;
