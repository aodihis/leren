import type { Observer } from "@leren/observability";
import { runReplyPipeline } from "@leren/reply-agent";
import type { ReplyPipelineDeps } from "@leren/reply-agent";

import type { PipelineRunner } from "./service";

/** What the pipeline runner needs from the process. It is built once and shared by every run. */
export type PipelineRunnerOptions = {
  harness: ReplyPipelineDeps["harness"];
  models: ReplyPipelineDeps["models"];
  /** The fixed prompts of the reply pipeline. */
  prompts: ReplyPipelineDeps["prompts"];
  observer: Observer;
  /** The address of the MCP server of the API. */
  mcpUrl: string;
};

/**
 * Builds the function that runs the reply pipeline for one message. The answering agent searches
 * the playbooks through the MCP server with the session token of the run.
 */
export function createPipelineRunner(options: PipelineRunnerOptions): PipelineRunner {
  return ({ input, allowedPlaybookIds, token, signal }) =>
    runReplyPipeline(
      {
        harness: options.harness,
        models: options.models,
        prompts: options.prompts,
        observer: options.observer,
        allowedPlaybookIds,
        mcp: { url: options.mcpUrl, token },
        abortSignal: signal,
      },
      input,
    );
}
