import { connectMcp } from "@leren/agents";
import type { McpConnection, McpOptions } from "@leren/agents";

/** The MCP tools the Reply Agent may use. */
export const allowedTools = ["search_playbooks", "list_playbooks", "get_playbook"] as const;

/** Connects to the MCP server for the Reply Agent. */
export function connectReplyMcp(
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
