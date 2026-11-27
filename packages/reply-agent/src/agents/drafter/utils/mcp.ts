import { connectMcp } from "@leren/agents";
import type { McpConnection, McpOptions } from "@leren/agents";

/**
 * The MCP tools the Reply Agent may use.
 *
 * The agent can only search and read playbooks. It has no tool that changes data, sends or approves
 * email, because the pipeline saves the result itself (decision 0042). It cannot list every playbook
 * either, because the playbooks that its tools return count as found, and the pipeline escalates an
 * email for which a search found none (decision 0066). The MCP server enforces scopes, and this list
 * is a second, client-side filter.
 */
export const allowedTools = ["search_playbooks", "get_playbook"] as const;

/**
 * Connects to the MCP server and exposes only the Reply Agent's tools. The URL is Leren's own MCP
 * endpoint, which comes from deployment configuration and commonly points at a loopback address,
 * so the library's check for private addresses is disabled.
 */
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
