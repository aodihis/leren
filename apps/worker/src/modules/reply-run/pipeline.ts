import type { Observer } from "@leren/observability";
import { createMcpRetriever, runReplyPipeline } from "@leren/reply-agent";
import type { ReplyPipelineDeps } from "@leren/reply-agent";

import type { PipelineRunner } from "./service";

/** What the pipeline runner needs from the process. */
export type PipelineRunnerOptions = {
  models: ReplyPipelineDeps["models"];
  /** The fixed system prompt of the Reply Agent. */
  rules: string;
  observer: Observer;
  /** The address of the MCP server of the API. */
  mcpUrl: string;
};

/** Builds the function that runs the reply pipeline. */
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
