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
 * The tools that change data. Every call needs the user's approval before it runs, so nothing is
 * created or changed without the user's confirmation.
 */
export const approvalTools = [
  "create_rule",
  "update_rule",
  "create_knowledge",
  "update_knowledge",
] as const;

/**
 * Connects to the MCP server and exposes only the Assistant Agent's tools. The tools that write
 * require the user's approval.
 */
export function connectAssistantMcp(
  options: McpOptions,
  abortSignal?: AbortSignal,
): Promise<McpConnection> {
  return connectMcp({ ...options, allowedTools, approvalTools, abortSignal });
}
