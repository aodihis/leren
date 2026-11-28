export { runAgent } from "./agents/drafter";

export type { RunAgentOptions } from "./agents/drafter";

export { createReplyPipeline, readReplyPrompts, runReplyPipeline } from "./pipeline";

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

export type { Playbook } from "./pipeline/playbooks";
