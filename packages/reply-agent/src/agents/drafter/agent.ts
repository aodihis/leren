import type { AgentPrompt, MemoryScope, Message } from "@anvia/core";
import { createAgent } from "@leren/agents";
import type { CreateAgentOptions, McpOptions } from "@leren/agents";
import { tools } from "./tools";
import { connectReplyMcp } from "./utils/mcp";

const AGENT_ID = "reply";
const MAX_TURNS = 6;

/** Everything one Reply Agent run needs. */
export interface RunAgentOptions extends Pick<
  CreateAgentOptions,
  "model" | "observer" | "tools" | "memory" | "maxTokens" | "controls"
> {
  readonly instructions: string;
  readonly prompt: AgentPrompt;
  readonly mcp?: McpOptions | undefined;
  readonly session?: MemoryScope | undefined;
  readonly abortSignal?: AbortSignal | undefined;
}

/** What one Reply Agent run produced: its text answer and the messages of the run. */
export interface ReplyRun {
  readonly output: string;
  /** The messages of the run, including the results of the tools that the agent called. */
  readonly messages: readonly Message[];
}

/**
 * Runs the Reply Agent once and returns its text answer together with the messages of the run.
 *
 * The agent runs as one step of the email pipeline, so the caller needs the final answer, and the
 * tool results that the pipeline checks the answer against, and not the events. When `mcp` is
 * given, the MCP connection is opened for this run only and is always closed. The agent is limited
 * to 6 turns, so that it can search for every question of an email and still answer (decision
 * 0066).
 */
export async function generateReply(options: RunAgentOptions): Promise<ReplyRun> {
  const connection = options.mcp
    ? await connectReplyMcp(options.mcp, options.abortSignal)
    : undefined;

  try {
    const agent = createAgent({
      id: AGENT_ID,
      maxTurns: MAX_TURNS,
      maxTokens: options.maxTokens,
      controls: options.controls,
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

/** Runs the Reply Agent once and returns its text answer. See `generateReply`. */
export async function runAgent(options: RunAgentOptions): Promise<string> {
  return (await generateReply(options)).output;
}
