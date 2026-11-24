import { connectMcp } from "@leren/agents";
import type { McpConnection, McpOptions } from "@leren/agents";
import { parseSearchResult } from "./pipeline";
import type { Retrieval } from "./pipeline";

const SEARCH_TOOL = "search_playbooks";

/** A retriever that holds one MCP connection. */
export interface McpRetriever {
  retrieve(query: string, abortSignal?: AbortSignal): Promise<Retrieval>;
  /** Closes the MCP connection, if one was opened. */
  close(): Promise<void>;
}

/** Whether a tool result reports a failed call. */
function isToolError(output: unknown): boolean {
  return (
    typeof output === "object" &&
    output !== null &&
    (output as { isError?: unknown }).isError === true
  );
}

/** Creates the retrieve function over the MCP server. */
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
