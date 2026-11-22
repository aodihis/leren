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
