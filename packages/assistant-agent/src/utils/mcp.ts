import { connectMcp } from "@leren/agents";
import type { McpConnection, McpOptions } from "@leren/agents";

/**
 * The MCP tools the Assistant Agent may use.
 *
 * The agent can create and change playbooks, including turning them on or off. It has no tool
 * that deletes anything or sends email. The MCP server enforces scopes, and this list is a second,
 * client-side filter.
 */
export const allowedTools = [
  "list_playbooks",
  "get_playbook",
  "search_playbooks",
  "create_playbook",
  "update_playbook",
] as const;

/**
 * Connects to the MCP server and exposes only the Assistant Agent's tools. The agent confirms
 * every change with the user in the conversation before it calls a tool that writes.
 *
 * The URL is Leren's own MCP endpoint, which comes from deployment configuration and commonly
 * points at a loopback address, so the library's check for private addresses is disabled.
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
 * Connects to the external MCP servers that a user has connected. Only the servers in `servers` are
 * opened, so a connector that the user has not added is never registered. A server that cannot be
 * reached is reported to `onError` and left out, because one unavailable tool must not stop the
 * run. The address is checked against loopback and private ranges, because it is not Leren's own.
 * The caller must call `close` on the result.
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
