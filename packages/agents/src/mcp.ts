import { McpClient, McpClientGroup } from "@anvia/mcp";
import type { McpConnectOptions, McpServer, McpStreamableHttpTransport } from "@anvia/mcp";

/** Connection details for the MCP server hosted by the API. */
export interface McpConnectionOptions {
  readonly url: McpStreamableHttpTransport["url"];
  readonly token: string;
  readonly allowedTools: readonly string[];
  readonly abortSignal?: McpConnectOptions["abortSignal"];
}

/** The part of the connection that identifies the server and the user's session. */
export type McpOptions = Pick<McpConnectionOptions, "url" | "token">;

/** Connected MCP servers, restricted to one role's tools. The owner must call `close`. */
export interface McpConnection {
  readonly servers: readonly McpServer[];
  close(): Promise<void>;
}

/**
 * Keeps only the tools whose remote name is in `allowedTools`.
 *
 * The result never contains a tool outside the allow-list, whatever the server advertises.
 */
export function restrictTools(server: McpServer, allowedTools: readonly string[]): McpServer {
  return {
    ...server,
    tools: server.tools.filter((tool) => allowedTools.includes(tool.mcp.remoteName)),
  };
}

/**
 * Connects to the MCP server with a user-bound session token and exposes only `allowedTools`.
 *
 * The token carries the user, scopes and expiry, and is minted by the API for one run. It is sent
 * as a bearer header and never appears in a tool argument or prompt.
 */
export async function connectMcp(options: McpConnectionOptions): Promise<McpConnection> {
  const client = new McpClient({
    name: "leren",
    transport: {
      type: "streamableHttp",
      url: options.url,
      headers: { Authorization: `Bearer ${options.token}` },
    },
  });

  const group = await McpClientGroup.connect({
    clients: [client],
    abortSignal: options.abortSignal,
  });

  return {
    servers: group.servers.map((server) => restrictTools(server, options.allowedTools)),
    close: () => group.close(),
  };
}
