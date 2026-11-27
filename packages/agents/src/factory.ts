import { Agent } from "@anvia/core";
import type { AgentOptions } from "@anvia/core";
import type { Observer } from "@leren/observability";

/**
 * Everything needed to build one agent.
 *
 * The fields come from Anvia's `AgentOptions`. The instructions and the turn limit are required
 * here, and the observer replaces Anvia's observability options. `maxTokens` limits the tokens
 * that the model writes in each turn, and `controls` sets the model's declared controls, such as
 * its reasoning effort, for each turn.
 */
export type CreateAgentOptions = Required<Pick<AgentOptions, "instructions" | "maxTurns">> &
  Pick<
    AgentOptions,
    "id" | "model" | "mcpServers" | "tools" | "memory" | "skills" | "maxTokens" | "controls"
  > & {
    readonly observer: Observer;
  };

/**
 * Builds an agent with a bounded number of turns and the observer's tracing.
 *
 * The id names the agent in traces, so each agent kind passes its own stable id. Tools reach the
 * agent only through the arguments, so the calling agent package decides the tool set.
 */
export function createAgent(options: CreateAgentOptions): Agent {
  return new Agent({
    id: options.id,
    model: options.model,
    instructions: options.instructions,
    maxTurns: options.maxTurns,
    maxTokens: options.maxTokens,
    controls: options.controls,
    mcpServers: options.mcpServers,
    tools: options.tools,
    memory: options.memory,
    skills: options.skills,
    observability: options.observer.forAgent(),
  });
}
