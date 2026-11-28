import { connectMcp } from "@leren/agents";
import type { McpConnection, McpOptions } from "@leren/agents";

/**
 * The MCP tools the Assistant Agent may use: it can create, change and toggle playbooks and read
 * processed mail, but never delete anything or send email. This list is a client-side filter in
 * addition to the scopes the server enforces.
 */
export const allowedTools = [
  "list_playbooks",
  "get_playbook",
  "describe_playbook_fields",
  "search_playbooks",
  "list_messages",
  "get_message",
  "create_playbook",
  "update_playbook",
] as const;

/**
 * Connects to Leren's own MCP server and exposes only the Assistant Agent's tools. The URL comes
 * from deployment configuration and is commonly a loopback address, so the library's private
 * address check is disabled.
 */
export function connectAssistantMcp(
  options: McpOptions,
  abortSignal?: AbortSignal,
): Promise<McpConnection> {
  return connectMcp({
    ...options,
    allowedTools,
    abortSignal,
    ssrfProtection: "disabled",
  });
}

/** One external MCP server that the user has connected, and the read-only tools it may expose. */
export interface ExternalMcpServer {
  readonly id: string;
  readonly url: string;
  readonly token: string;
  readonly allowedTools: readonly string[];
}

/**
 * Connects to the external MCP servers in `servers`, so a connector the user has not added is never
 * registered. An unreachable server is reported to `onError` and left out instead of stopping the
 * run. Private and loopback addresses are refused. The caller must call `close` on the result.
 */
export async function connectExternalMcpServers(
  servers: readonly ExternalMcpServer[],
  onError: (id: string, error: unknown) => void,
  abortSignal?: AbortSignal,
): Promise<McpConnection> {
  const attempts = await Promise.all(
    servers.map(async (server) => {
      try {
        return await connectMcp({
          name: `leren-${server.id}`,
          url: new URL(server.url),
          token: server.token,
          allowedTools: server.allowedTools,
          toolPrefix: server.id,
          negotiateVersion: true,
          ssrfProtection: "strict",
          abortSignal,
        });
      } catch (error) {
        onError(server.id, error);

        return null;
      }
    }),
  );

  const connections = attempts.filter((connection) => connection !== null);

  for (const [index, connection] of attempts.entries()) {
    if (connection && connection.servers.every((server) => server.tools.length === 0)) {
      onError(
        servers[index]?.id ?? "unknown",
        new Error("The server offers none of the allowed tools"),
      );
    }
  }

  return {
    servers: connections.flatMap((connection) => connection.servers),
    close: async () => {
      await Promise.allSettled(connections.map((connection) => connection.close()));
    },
  };
}
