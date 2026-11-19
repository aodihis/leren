/**
 * The MCP tools the Reply Agent may use.
 *
 * The agent can only read data, create a draft and request approval. No tool sends or approves
 * email. The MCP server enforces scopes, and this list is a second, client-side filter.
 */
export const allowedTools = [
  "search_knowledge",
  "get_message",
  "list_rules",
  "create_draft",
  "request_approval",
] as const;
