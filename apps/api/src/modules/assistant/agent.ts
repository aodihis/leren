import type {
  AgentStreamEvent,
  CompletionModel,
  MemoryScope,
  MemoryStore,
  Message,
} from "@anvia/core";
import { runAgent } from "@leren/assistant-agent";
import { mintSession, revokeSession } from "@leren/mcp-server";
import type { SessionDependencies } from "@leren/mcp-server";
import type { Logger } from "@leren/logger";
import type { Observer } from "@leren/observability";

/** One run of the assistant for a signed-in user. */
export type AgentRunInput = {
  userId: string;
  messages: readonly Message[];
  memory: { store: MemoryStore; session: MemoryScope };
  abortSignal: AbortSignal;
};

/** Runs the assistant for one message. */
export type Agent = (input: AgentRunInput) => AsyncIterable<AgentStreamEvent>;

export type AgentOptions = {
  sessions: SessionDependencies;
  /** The URL of the API's own MCP endpoint. */
  mcpUrl: string;
  instructions: string;
  model: CompletionModel;
  observer: Observer;
  logger: Logger;
};

/** Builds the agent that serves the chat. */
export function createAgent(options: AgentOptions): Agent {
  return async function* run(input) {
    const minted = await mintSession(options.sessions, { userId: input.userId, role: "assistant" });

    try {
      yield* runAgent({
        instructions: options.instructions,
        model: options.model,
        observer: options.observer,
        messages: input.messages,
        memory: input.memory,
        abortSignal: input.abortSignal,
        mcp: { url: new URL(options.mcpUrl), token: minted.token },
      });
    } finally {
      await revokeSession(options.sessions, input.userId, minted.sessionId).catch((error) => {
        options.logger.error("Could not revoke the assistant's MCP session", { error });
      });
    }
  };
}
