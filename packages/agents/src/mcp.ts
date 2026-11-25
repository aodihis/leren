import { McpClient, McpClientGroup } from "@anvia/mcp";
import type {
  McpClientOptions,
  McpConnectOptions,
  McpServer,
  McpStreamableHttpTransport,
} from "@anvia/mcp";

/** Connection details for the MCP server hosted by the API. */
export interface McpConnectionOptions {
  readonly url: McpStreamableHttpTransport["url"];
  readonly token: string;
  readonly allowedTools: readonly string[];
  /** The allowed tools whose every call needs the user's approval before it runs. */
  readonly approvalTools?: readonly string[] | undefined;
  readonly abortSignal?: McpConnectOptions["abortSignal"];
  /**
   * Whether the library refuses URLs that resolve to loopback or private addresses. It defaults
   * to `strict`. Only the address of Leren's own MCP endpoint, which comes from deployment
   * configuration, may use `disabled`. A server that a user or an administrator supplies must
   * keep `strict`, so that it cannot be used to reach internal services.
   */
  readonly ssrfProtection?: "strict" | "disabled" | undefined;
  /** The client name that identifies this connection to the server. It defaults to `leren`. */
  readonly name?: string | undefined;
  /** A prefix for the local names of the server's tools, so that two servers cannot collide. */
  readonly toolPrefix?: string | undefined;
  /**
   * Whether the client falls back to older protocol revisions. External servers are not under
   * Leren's control, so they negotiate. The default is the library's own default.
   */
  readonly negotiateVersion?: boolean | undefined;
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
 * The result never contains a tool outside the allow-list, whatever the server advertises. A tool
 * whose remote name is in `approvalTools` requires the user's approval for every call, so the
 * runtime pauses the run until the user decides.
 */
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

/**
 * Connects to the MCP server with a user-bound session token and exposes only `allowedTools`.
 *
 * The token carries the user, scopes and expiry, and is minted by the API for one run. It is sent
 * as a bearer header and never appears in a tool argument or prompt.
 */
export async function connectMcp(options: McpConnectionOptions): Promise<McpConnection> {
  const clientOptions: McpClientOptions = {
    name: options.name ?? "leren",
    transport: {
      type: "streamableHttp",
      url: options.url,
      ssrfProtection: options.ssrfProtection ?? "strict",
      headers: { Authorization: `Bearer ${options.token}` },
    },
    versionNegotiation: options.negotiateVersion ? { mode: "auto" } : undefined,
    tools: options.toolPrefix ? { prefix: options.toolPrefix } : undefined,
  };

  const client = new McpClient(clientOptions);

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
