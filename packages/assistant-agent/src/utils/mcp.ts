import { connectMcp } from "@leren/agents";
import type { McpConnection, McpOptions } from "@leren/agents";

/**
 * The MCP tools the Assistant Agent may use.
 *
 * The agent can create and change rules and knowledge. It has no tool that approves knowledge,
 * deletes anything or sends email. The MCP server enforces scopes, and this list is a second,
 * client-side filter.
 */
export const allowedTools = [
  "list_rules",
  "get_rule",
  "list_knowledge",
  "get_knowledge",
  "search_knowledge",
  "create_rule",
  "update_rule",
  "create_knowledge",
  "update_knowledge",
] as const;

/**
 * Connects to the MCP server and exposes only the Assistant Agent's tools. The agent confirms
 * every change with the user in the conversation before it calls a tool that writes.
 */
export function connectAssistantMcp(
  options: McpOptions,
  abortSignal?: AbortSignal,
): Promise<McpConnection> {
  return connectMcp({ ...options, allowedTools, abortSignal });
}
