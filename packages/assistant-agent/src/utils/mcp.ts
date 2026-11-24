import { connectMcp } from "@leren/agents";
import type { McpConnection, McpOptions } from "@leren/agents";

/** The MCP tools the assistant may use. */
export const allowedTools = [
  "list_playbooks",
  "get_playbook",
  "search_playbooks",
  "create_playbook",
  "update_playbook",
] as const;

/** Connects to the MCP server for the assistant. */
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
