import type { Observer } from "@leren/observability";
import { createMcpRetriever, runReplyPipeline } from "@leren/reply-agent";
import type { ReplyPipelineDeps } from "@leren/reply-agent";

import type { PipelineRunner } from "./service";

/** What the pipeline runner needs from the process. It is built once and shared by every run. */
export type PipelineRunnerOptions = {
  models: ReplyPipelineDeps["models"];
  /** The fixed system prompt of the Reply Agent. */
  rules: string;
  observer: Observer;
  /** The address of the MCP server of the API. */
  mcpUrl: string;
};

/**
 * Builds the function that runs the reply pipeline for one message. Each run has its own MCP
 * connection, which searches for the questions of the email and is closed when the run ends,
 * whether it succeeded or failed. The drafting agent connects with the same session token.
 */
export function createPipelineRunner(options: PipelineRunnerOptions): PipelineRunner {
  return async ({ input, allowedPlaybookIds, token, signal }) => {
    const mcp = { url: options.mcpUrl, token };
    const retriever = createMcpRetriever(mcp);

    try {
      return await runReplyPipeline(
        {
          models: options.models,
          rules: options.rules,
          observer: options.observer,
          retrieve: (query, abortSignal) => retriever.retrieve(query, abortSignal),
          allowedPlaybookIds,
          mcp,
          abortSignal: signal,
        },
        input,
      );
    } finally {
      await retriever.close();
    }
  };
}
