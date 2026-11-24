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

/** An assistant agent with its MCP connection. */
export interface AssistantAgent {
  readonly agent: Agent;
  /** Closes the MCP connection, if there is one. */
  close(): Promise<void>;
}

/** Builds the assistant agent. */
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
export interface RunAgentOptions extends Omit<AssistantAgentOptions, "memory"> {
  /** The conversation, ending with the new message. */
  readonly messages: readonly Message[];
  /** Where the conversation is stored. */
  readonly memory?: { readonly store: MemoryStore; readonly session: MemoryScope } | undefined;
}

/** Runs the assistant once and yields stream events. */
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
