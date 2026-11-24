import type { RunAgentPayload } from "./schema";

export type AgentRunResult = {
  output: unknown;
};

/** An AI agent that the worker can run. */
export type Agent = {
  id: string;
  run(input: RunAgentPayload, context: { signal: AbortSignal }): Promise<AgentRunResult>;
};

export type AgentRegistry = ReadonlyMap<string, Agent>;

/** Creates the registry that maps ids to agents. */
export function createAgentRegistry(agents: Agent[]): AgentRegistry {
  return new Map(agents.map((agent) => [agent.id, agent]));
}

/** Runs the agent named by the payload. */
export async function runAgent(
  registry: AgentRegistry,
  payload: RunAgentPayload,
  context: { signal: AbortSignal },
): Promise<AgentRunResult> {
  const agent = registry.get(payload.agentId);

  if (!agent) {
    throw new Error(`Unknown agent: ${payload.agentId}`);
  }

  return agent.run(payload, context);
}
