import { connectMcp } from "@leren/agents";
import type { McpConnection } from "@leren/agents";
import { allowedTools } from "../tools";

/** Connection details for the MCP server hosted by the API. */
export interface McpOptions {
  readonly url: string;
  readonly token: string;
}

/** Connects to the MCP server and exposes only the Assistant Agent's tools. */
export function connectAssistantMcp(
  options: McpOptions,
  abortSignal?: AbortSignal,
): Promise<McpConnection> {
  return connectMcp({ ...options, allowedTools, abortSignal });
}
