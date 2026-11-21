import { fileURLToPath } from "node:url";
import { loadSkills, skill } from "@anvia/core";
import type { Agent, AgentPrompt, AgentStreamEvent, MemoryScope } from "@anvia/core";
import { createAgent } from "@leren/agents";
import type { CreateAgentOptions, McpOptions } from "@leren/agents";
import { tools } from "./tools";
import { connectAssistantMcp } from "./utils/mcp";

const AGENT_ID = "assistant";
const MAX_TURNS = 75;
const SKILLS_DIR = fileURLToPath(new URL("../skills", import.meta.url));

/** Everything needed to build the Assistant Agent. */
export interface AssistantAgentOptions extends Pick<
  CreateAgentOptions,
  "model" | "observer" | "tools" | "memory"
> {
  readonly instructions: string;
  readonly mcp?: McpOptions | undefined;
  readonly abortSignal?: AbortSignal | undefined;
}

/** An Assistant Agent together with the MCP connection it owns. */
export interface AssistantAgent {
  readonly agent: Agent;
  /** Closes the MCP connection, if there is one. Safe to call when there is none. */
  close(): Promise<void>;
}

/**
 * Builds the Assistant Agent. When `mcp` is given, the MCP connection is opened here and the caller
 * must call `close` so that the connection does not outlive the agent. The agent is limited to 75
 * turns. The agent has the skills in the package's `skills` directory.
 */
export async function createAssistantAgent(
  options: AssistantAgentOptions,
): Promise<AssistantAgent> {
  const skills = await loadSkills(skill.local(SKILLS_DIR));

  const connection = options.mcp
    ? await connectAssistantMcp(options.mcp, options.abortSignal)
    : undefined;

  try {
    const agent = createAgent({
      id: AGENT_ID,
      maxTurns: MAX_TURNS,
      model: options.model,
      instructions: options.instructions,
      observer: options.observer,
      mcpServers: connection?.servers,
      tools: [...tools, ...(options.tools ?? [])],
      memory: options.memory,
      skills,
    });

    return { agent, close: async () => connection?.close() };
  } catch (error) {
    await connection?.close();

    throw error;
  }
}

/** Everything one Assistant Agent run needs. */
export interface RunAgentOptions extends AssistantAgentOptions {
  readonly prompt: AgentPrompt;
  readonly session?: MemoryScope | undefined;
}

/**
 * Runs the Assistant Agent once and yields its stream events as they happen.
 *
 * The MCP connection is opened when iteration starts and is closed when the stream ends, fails or
 * is abandoned by the caller, so it cannot outlive the run.
 * Conversation history is loaded and saved only when `memory` and `session` are both given.
 */
export async function* runAgent(options: RunAgentOptions): AsyncGenerator<AgentStreamEvent> {
  const { agent, close } = await createAssistantAgent(options);

  try {
    yield* agent.stream({
      prompt: options.prompt,
      session: options.session,
      abortSignal: options.abortSignal,
    });
  } finally {
    await close();
  }
}
