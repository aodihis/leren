/**
 * The MCP tools the Assistant Agent may use.
 *
 * The agent only reads data and creates proposals that the user accepts in the interface. No tool
 * approves a change or sends email. The MCP server enforces scopes, and this list is a second,
 * client-side filter.
 */
export const allowedTools = [
  "search_knowledge",
  "get_knowledge_item",
  "list_rules",
  "suggest_questions",
  "propose_knowledge_edit",
] as const;
