import type {
  AgentStreamEvent,
  CompletionModel,
  MemoryScope,
  MemoryStore,
  Message,
} from "@anvia/core";
import { runAgent } from "@leren/assistant-agent";
import { listConnectorSessions } from "@leren/connectors";
import type { ConnectorsDependencies } from "@leren/connectors";
import type { Db } from "@leren/db";
import { mintSession, revokeSession } from "@leren/mcp-server";
import type { SessionDependencies } from "@leren/mcp-server";
import type { Logger } from "@leren/logger";
import type { Observer } from "@leren/observability";

/** One run of the Assistant Agent for a signed-in user. */
export type AgentRunInput = {
  userId: string;
  messages: readonly Message[];
  memory: { store: MemoryStore; session: MemoryScope };
  abortSignal: AbortSignal;
};

/** Runs the Assistant Agent for one message and yields its stream events. */
export type Agent = (input: AgentRunInput) => AsyncIterable<AgentStreamEvent>;

export type AgentOptions = {
  sessions: SessionDependencies;
  /** The URL of the API's own MCP endpoint. */
  mcpUrl: string;
  instructions: string;
  model: CompletionModel;
  observer: Observer;
  logger: Logger;
  db: Db;
  /** The enabled connectors. A user's own connections decide which of them an agent run uses. */
  connectors: ConnectorsDependencies;
};

/**
 * Builds the agent that serves the chat. Every run gets its own MCP session, bound to the user and
 * limited to the `assistant` role, which is revoked when the run ends in any way. A run registers
 * only the external MCP servers of the user's active connections (decision 0054).
 */
export function createAgent(options: AgentOptions): Agent {
  return async function* run(input) {
    const minted = await mintSession(options.sessions, { userId: input.userId, role: "assistant" });

    try {
      const connectors = await listConnectorSessions(
        options.db,
        options.connectors,
        input.userId,
        (connector, error) => {
          options.logger.warn("A connector is unavailable for this run", { connector, error });
        },
      );

      yield* runAgent({
        instructions: options.instructions,
        model: options.model,
        observer: options.observer,
        messages: input.messages,
        memory: input.memory,
        abortSignal: input.abortSignal,
        mcp: { url: new URL(options.mcpUrl), token: minted.token },
        connectors,
        onConnectorError: (connector, error) => {
          options.logger.warn("A connector could not be reached", { connector, error });
        },
      });
    } finally {
      await revokeSession(options.sessions, input.userId, minted.sessionId).catch((error) => {
        options.logger.error("Could not revoke the assistant's MCP session", { error });
      });
    }
  };
}
