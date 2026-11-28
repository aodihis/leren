import { connectMcp } from "@leren/agents";
import type { McpConnection, McpOptions } from "@leren/agents";

/**
 * The MCP tools the Reply Agent may use: only searching and reading playbooks, because the pipeline
 * saves the result itself (decision 0042). There is no list tool, because returned playbooks count
 * as found (decision 0066). This list is a client-side filter in addition to the scopes the server
 * enforces.
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
