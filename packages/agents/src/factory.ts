import { Agent } from "@anvia/core";
import type { AgentOptions } from "@anvia/core";
import type { Observer } from "@leren/observability";

/** Everything needed to build one agent. */
export type CreateAgentOptions = Required<Pick<AgentOptions, "instructions" | "maxTurns">> &
  Pick<AgentOptions, "id" | "model" | "mcpServers" | "tools" | "memory" | "skills"> & {
    readonly observer: Observer;
  };

/** Builds an agent with bounded turns and tracing. */
export function createAgent(options: CreateAgentOptions): Agent {
  return new Agent({
    id: options.id,
    model: options.model,
    instructions: options.instructions,
    maxTurns: options.maxTurns,
    mcpServers: options.mcpServers,
    tools: options.tools,
    memory: options.memory,
    skills: options.skills,
    observability: options.observer.forAgent(),
  });
}
