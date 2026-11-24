import { McpClient, McpClientGroup } from "@anvia/mcp";
import type { McpConnectOptions, McpServer, McpStreamableHttpTransport } from "@anvia/mcp";

/** Connection details for the MCP server. */
export interface McpConnectionOptions {
  readonly url: McpStreamableHttpTransport["url"];
  readonly token: string;
  readonly allowedTools: readonly string[];
  /** The allowed tools that need user approval. */
  readonly approvalTools?: readonly string[] | undefined;
  readonly abortSignal?: McpConnectOptions["abortSignal"];
  /** Whether private addresses are refused. */
  readonly ssrfProtection?: "strict" | "disabled" | undefined;
}

/** The part of the connection that identifies it. */
export type McpOptions = Pick<McpConnectionOptions, "url" | "token">;

/** Connected MCP servers limited to one role. */
export interface McpConnection {
  readonly servers: readonly McpServer[];
  close(): Promise<void>;
}

/** Keeps only the allowed tools. */
export function restrictTools(
  server: McpServer,
  allowedTools: readonly string[],
  approvalTools: readonly string[] = [],
): McpServer {
  return {
    ...server,
    tools: server.tools
      .filter((tool) => allowedTools.includes(tool.mcp.remoteName))
      .map((tool) =>
        approvalTools.includes(tool.mcp.remoteName) ? { ...tool, requiresApproval: true } : tool,
      ),
  };
}

/** Connects to the MCP server with a session token. */
export async function connectMcp(options: McpConnectionOptions): Promise<McpConnection> {
  const client = new McpClient({
    name: "leren",
    transport: {
      type: "streamableHttp",
      url: options.url,
      ssrfProtection: options.ssrfProtection ?? "strict",
      headers: { Authorization: `Bearer ${options.token}` },
    },
  });

  const group = await McpClientGroup.connect({
    clients: [client],
    abortSignal: options.abortSignal,
  });

  return {
    servers: group.servers.map((server) =>
      restrictTools(server, options.allowedTools, options.approvalTools),
    ),
    close: () => group.close(),
  };
}
