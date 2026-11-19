import type {
  AgentMemoryOptions,
  AgentPrompt,
  AgentToolInput,
  CompletionModel,
  MemoryScope,
} from "@anvia/core";
import { createAgent } from "@leren/agents";
import type { Observer } from "@leren/observability";
import { instructions } from "./instructions";
import { tools } from "./tools";
import { connectReplyMcp } from "./utils/mcp";
import type { McpOptions } from "./utils/mcp";

const AGENT_ID = "reply";
const MAX_TURNS = 5;

/** Everything one Reply Agent run needs. */
export interface RunAgentOptions {
  readonly prompt: AgentPrompt;
  readonly model: CompletionModel;
  readonly observer: Observer;
  readonly mcp?: McpOptions | undefined;
  readonly tools?: readonly AgentToolInput[] | undefined;
  readonly memory?: AgentMemoryOptions | undefined;
  readonly session?: MemoryScope | undefined;
  readonly abortSignal?: AbortSignal | undefined;
}

/**
 * Runs the Reply Agent once and returns its text answer.
 *
 * The agent runs as one step of the email pipeline, so the caller needs only the final answer and
 * not the events. When `mcp` is given, the MCP connection is opened for this run only and is always closed. The agent
 * is limited to 5 turns, as decided in ADR 0006.
 */
export async function runAgent(options: RunAgentOptions): Promise<string> {
  const connection = options.mcp
    ? await connectReplyMcp(options.mcp, options.abortSignal)
    : undefined;

  try {
    const agent = createAgent({
      id: AGENT_ID,
      maxTurns: MAX_TURNS,
      model: options.model,
      instructions,
      observer: options.observer,
      mcpServers: connection?.servers,
      tools: [...tools, ...(options.tools ?? [])],
      memory: options.memory,
    });

    const response = await agent.generate({
      prompt: options.prompt,
      session: options.session,
      abortSignal: options.abortSignal,
    });

    if (response.type !== "response") {
      throw new Error(`The Reply Agent stopped without an answer: ${response.type}.`);
    }

    return response.output;
  } finally {
    await connection?.close();
  }
}
