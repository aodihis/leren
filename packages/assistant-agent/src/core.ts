import type {
  AgentMemoryOptions,
  AgentPrompt,
  AgentStreamEvent,
  AgentToolInput,
  CompletionModel,
  MemoryScope,
} from "@anvia/core";
import { createAgent } from "@leren/agents";
import type { Observer } from "@leren/observability";
import { instructions } from "./instructions";
import { connectAssistantMcp } from "./utils/mcp";
import type { McpOptions } from "./utils/mcp";

const AGENT_ID = "assistant";
const MAX_TURNS = 75;

/** Everything one Assistant Agent run needs. */
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
 * Runs the Assistant Agent once and yields its stream events as they happen.
 *
 * When `mcp` is given, the MCP connection is opened when iteration starts and is closed when the stream ends, fails or
 * is abandoned by the caller, so it cannot outlive the run. The agent is limited to 75 turns.
 * Conversation history is loaded and saved only when `memory` and `session` are both given.
 */
export async function* runAgent(options: RunAgentOptions): AsyncGenerator<AgentStreamEvent> {
  const connection = options.mcp
    ? await connectAssistantMcp(options.mcp, options.abortSignal)
    : undefined;

  try {
    const agent = createAgent({
      id: AGENT_ID,
      maxTurns: MAX_TURNS,
      model: options.model,
      instructions,
      observer: options.observer,
      mcpServers: connection?.servers,
      tools: options.tools,
      memory: options.memory,
    });

    yield* agent.stream({
      prompt: options.prompt,
      session: options.session,
      abortSignal: options.abortSignal,
    });
  } finally {
    await connection?.close();
  }
}
