export { runAgent } from "./agents/drafter";

export type { RunAgentOptions } from "./agents/drafter";

export { createReplyPipeline, judge, readReplyPrompts, runReplyPipeline } from "./pipeline";

export type {
  Category,
  Draft,
  Email,
  Evaluation,
  Outcome,
  PipelineInput,
  ReplyPipelineDeps,
  ReplyPrompts,
  ReplyResult,
  Triage,
  Verdict,
} from "./pipeline";

export { createMcpRetriever, parseSearchResult } from "./agents/retriever";

export type { McpRetriever, Playbook, Retrieval } from "./agents/retriever";
