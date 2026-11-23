import { connectMcp } from "@leren/agents";
import type { McpConnection, McpOptions } from "@leren/agents";
import { parseSearchResult } from "./pipeline";
import type { Retrieval } from "./pipeline";

const SEARCH_TOOL = "search_playbooks";

/** A retriever that holds one MCP connection. The owner must call `close`. */
export interface McpRetriever {
  retrieve(query: string, abortSignal?: AbortSignal): Promise<Retrieval>;
  /** Closes the MCP connection, if one was opened. Safe to call more than once. */
  close(): Promise<void>;
}

/** Whether a tool result is the server's own report that the call failed. */
function isToolError(output: unknown): boolean {
  return (
    typeof output === "object" &&
    output !== null &&
    (output as { isError?: unknown }).isError === true
  );
}

/**
 * Creates the `retrieve` function of the pipeline over the MCP server (decision 0042). The session
 * token fixes the user, so a query can only reach that user's playbooks. The connection is opened
 * on the first query and is shared by the queries of one message, and it exposes the search tool
 * only. It does not depend on the abort signal of any one query: a signal stops its own call. A
 * connection that failed to open is not kept, so the next query opens a new one.
 *
 * A result without a playbook is `no_reliable_result`. A failed call is not that: it throws, so
 * that a server or authorization problem is retried by the queue and is not recorded as an
 * escalation for every message.
 */
export function createMcpRetriever(options: McpOptions): McpRetriever {
  let connection: Promise<McpConnection> | undefined;

  const open = (): Promise<McpConnection> => {
    connection ??= connectMcp({
      ...options,
      allowedTools: [SEARCH_TOOL],
      ssrfProtection: "disabled",
    }).catch((error: unknown) => {
      connection = undefined;

      throw error;
    });

    return connection;
  };

  return {
    async retrieve(query, abortSignal) {
      const { servers } = await open();

      const tool = servers
        .flatMap((server) => server.tools)
        .find((candidate) => candidate.mcp.remoteName === SEARCH_TOOL);

      if (!tool) {
        throw new Error(`The MCP server does not offer the ${SEARCH_TOOL} tool.`);
      }

      const output = await tool.call({ query }, { abortSignal });

      if (isToolError(output)) {
        throw new Error(`The ${SEARCH_TOOL} tool failed.`);
      }

      return parseSearchResult(output);
    },

    async close() {
      const pending = connection;

      connection = undefined;
      await pending?.then(
        (opened) => opened.close(),
        () => undefined,
      );
    },
  };
}
