/**
 * Placeholder contract for future AI agent execution.
 * An agent run is triggered by a job (see jobs/) so it gets retries,
 * cancellation and isolation from the API process.
 */
export interface AgentRunInput {
  agentId: string;
  input: unknown;
}

export interface AgentRunResult {
  output: unknown;
}

export interface Agent {
  id: string;
  run(input: AgentRunInput, ctx: { signal: AbortSignal }): Promise<AgentRunResult>;
}
