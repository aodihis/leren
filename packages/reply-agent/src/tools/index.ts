import type { AgentToolInput } from "@anvia/core";

/**
 * The tools that belong to this agent, such as a web search tool built with `createTool`.
 *
 * Tools served by the MCP server are not listed here. `runAgent` adds them from the MCP
 * connection, and the tools passed in its options are added after these.
 */
export const tools: readonly AgentToolInput[] = [];
