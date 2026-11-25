import { fileURLToPath } from "node:url";
import { loadSkills, skill } from "@anvia/core";
import type {
  Agent,
  AgentStreamEvent,
  MemoryScope,
  MemoryStore,
  Message,
  UserMessage,
} from "@anvia/core";
import { createAgent } from "@leren/agents";
import type { CreateAgentOptions, McpOptions } from "@leren/agents";
import { tools } from "./tools";
import { connectAssistantMcp, connectExternalMcpServers } from "./utils/mcp";
import type { ExternalMcpServer } from "./utils/mcp";

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
  /**
   * The external MCP servers that the user has connected. A server that is not listed is never
   * registered, and an empty list registers none.
   */
  readonly connectors?: readonly ExternalMcpServer[] | undefined;
  /** Called with the id of a connector whose server could not be reached. */
  readonly onConnectorError?: ((id: string, error: unknown) => void) | undefined;
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

  const external =
    options.connectors && options.connectors.length > 0
      ? await connectExternalMcpServers(
          options.connectors,
          options.onConnectorError ?? (() => {}),
          options.abortSignal,
        ).catch(async (error: unknown) => {
          await connection?.close();

          throw error;
        })
      : undefined;

  try {
    const agent = createAgent({
      id: AGENT_ID,
      maxTurns: MAX_TURNS,
      model: options.model,
      instructions: options.instructions,
      observer: options.observer,
      mcpServers: [...(connection?.servers ?? []), ...(external?.servers ?? [])],
      tools: [...tools, ...(options.tools ?? [])],
      memory: options.memory,
      skills,
    });

    return {
      agent,
      close: async () => {
        await Promise.allSettled([connection?.close(), external?.close()]);
      },
    };
  } catch (error) {
    await Promise.allSettled([connection?.close(), external?.close()]);

    throw error;
  }
}

/** Everything one Assistant Agent run needs. */
export interface RunAgentOptions extends Omit<AssistantAgentOptions, "memory"> {
  /** The conversation so far, ending with the user's new message. */
  readonly messages: readonly Message[];
  /** Where the conversation is stored. Without it, the run sees only `messages`. */
  readonly memory?: { readonly store: MemoryStore; readonly session: MemoryScope } | undefined;
}

/**
 * Runs the Assistant Agent once and yields its stream events as they happen.
 *
 * The MCP connection is opened when iteration starts and is closed when the stream ends, fails or
 * is abandoned by the caller, so it cannot outlive the run. When `memory` is given, the store
 * already holds the earlier turns, so only the newest user message is sent and the turn is saved
 * when it ends. Otherwise all of `messages` is sent and nothing is saved.
 */
export async function* runAgent(options: RunAgentOptions): AsyncGenerator<AgentStreamEvent> {
  const { agent, close } = await createAssistantAgent({
    ...options,
    memory: options.memory && { store: options.memory.store, savePolicy: "turn" },
  });

  try {
    if (options.memory) {
      const prompt = options.messages
        .toReversed()
        .find((message): message is UserMessage => message.role === "user");

      if (!prompt) {
        throw new Error("The Assistant Agent needs at least one user message.");
      }

      yield* agent.stream({
        prompt,
        session: options.memory.session,
        abortSignal: options.abortSignal,
      });
    } else {
      yield* agent.stream({ messages: options.messages, abortSignal: options.abortSignal });
    }
  } finally {
    await close();
  }
}
