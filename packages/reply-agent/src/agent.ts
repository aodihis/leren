import type { AgentPrompt, MemoryScope, Message } from "@anvia/core";
import { createAgent } from "@leren/agents";
import type { CreateAgentOptions, McpOptions } from "@leren/agents";
import { tools } from "./tools";
import { connectReplyMcp } from "./utils/mcp";

const AGENT_ID = "reply";
const MAX_TURNS = 5;

/** Everything one Reply Agent run needs. */
export interface RunAgentOptions extends Pick<
  CreateAgentOptions,
  "model" | "observer" | "tools" | "memory"
> {
  readonly instructions: string;
  readonly prompt: AgentPrompt;
  readonly mcp?: McpOptions | undefined;
  readonly session?: MemoryScope | undefined;
  readonly abortSignal?: AbortSignal | undefined;
}

/** What one Reply Agent run produced. */
export interface ReplyRun {
  readonly output: string;
  /** The messages of the run. */
  readonly messages: readonly Message[];
}

/** Runs the Reply Agent once with run messages. */
export async function generateReply(options: RunAgentOptions): Promise<ReplyRun> {
  const connection = options.mcp
    ? await connectReplyMcp(options.mcp, options.abortSignal)
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
    });

    const response = await agent.generate({
      prompt: options.prompt,
      session: options.session,
      abortSignal: options.abortSignal,
    });

    if (response.type !== "response") {
      throw new Error(`The Reply Agent stopped without an answer: ${response.type}.`);
    }

    return { output: response.output, messages: response.messages };
  } finally {
    await connection?.close();
  }
}

/** Runs the Reply Agent once. */
export async function runAgent(options: RunAgentOptions): Promise<string> {
  return (await generateReply(options)).output;
}
