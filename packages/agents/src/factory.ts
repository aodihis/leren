import { Agent } from "@anvia/core";
import type { AgentMemoryOptions, AgentToolInput, CompletionModel } from "@anvia/core";
import type { McpServer } from "@anvia/mcp";
import type { Observer } from "@leren/observability";

/** Everything needed to build one agent. */
export interface CreateAgentOptions {
  readonly id: string;
  readonly maxTurns: number;
  readonly model: CompletionModel;
  readonly instructions: string;
  readonly observer: Observer;
  readonly mcpServers?: readonly McpServer[] | undefined;
  readonly tools?: readonly AgentToolInput[] | undefined;
  readonly memory?: AgentMemoryOptions | undefined;
}

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
    mcpServers: options.mcpServers,
    tools: options.tools,
    memory: options.memory,
    observability: options.observer.forAgent(),
  });
}
