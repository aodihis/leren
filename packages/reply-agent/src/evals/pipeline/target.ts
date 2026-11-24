import type { EvalTarget } from "@anvia/core/evals";
import type { PipelineTraceInfo } from "@anvia/core/pipeline";
import { loadHarness } from "@leren/agents";
import { observer } from "../observer";
import type { Playbook, Retrieval } from "../../agents/retriever";
import { readReplyPrompts, runReplyPipelineTraced } from "../../pipeline";
import type { Category, Outcome, ReplyPipelineDeps } from "../../pipeline";

const harness = await loadHarness();

/** The models, prompt and observer that every eval case shares. */
export const sharedDeps = {
  models: {
    triage: harness.createModel("replyTriage"),
    draft: harness.createModel("reply"),
    judge: harness.createModel("replyJudge"),
  },
  prompts: await readReplyPrompts(harness),
  observer,
};

/** The input of one eval case: an email, the playbooks that retrieval returns and the options. */
export type ReplyEvalInput = {
  email: { from: string; subject: string; body: string };
  /** What retrieval returns. An empty list stands for `no_reliable_result`. */
  playbooks: readonly Playbook[];
  checkMention?: boolean;
  replyInstructions?: string;
};

/** What the pipeline produced for one case. */
export type ReplyEvalOutput = {
  outcome: Outcome;
  /** The category that triage chose, or undefined when the run ended before triage. */
  category: Category | undefined;
  /** Whether the drafting agent ran. It is false when the pipeline abstained or routed early. */
  drafted: boolean;
  body: string | undefined;
  citations: readonly string[];
  reasons: readonly string[];
  revisions: number;
  /** What the evaluator found wrong in each draft that it rejected. */
  rejectedDrafts: readonly string[];
  /** The pipeline run's trace, which lets the reporter link a result to the run that produced it. */
  trace?: PipelineTraceInfo | undefined;
};

/** What a case expects. Only the fields that are set are checked. */
export type ReplyExpectation = {
  /** The outcome that the pipeline must reach, or the outcomes that are equally acceptable. */
  outcome: Outcome | readonly Outcome[];
  /** The category that triage must choose. */
  category?: Category;
  /** Substrings that the body must contain, ignoring case. */
  mustInclude?: readonly string[];
  /** Substrings that the body must not contain, ignoring case. */
  mustNotInclude?: readonly string[];
  /** The playbook ids that the citations must stay within. */
  citeWithin?: readonly string[];
};

/** Builds a playbook fixture. Anything that is not given is empty. */
export function playbook(
  fields: Pick<Playbook, "id" | "topic" | "response"> & Partial<Playbook>,
): Playbook {
  return { restrictions: "", examples: [], ...fields };
}

/**
 * Runs the real reply pipeline, with the production prompt and models, against fixed playbooks
 * instead of the MCP server, so that a case controls exactly what retrieval returns.
 */
export const target: EvalTarget<ReplyEvalInput, ReplyEvalOutput> = async (
  input,
  _testCase,
  context,
) => {
  const retrieval: Retrieval =
    input.playbooks.length === 0
      ? { status: "no_reliable_result" }
      : { status: "ok", playbooks: input.playbooks };

  const deps: ReplyPipelineDeps = {
    ...sharedDeps,
    retrieve: async () => retrieval,
    abortSignal: context?.signal,
  };

  const { result, trace } = await runReplyPipelineTraced(deps, {
    messageId: "eval",
    email: input.email,
    checkMention: input.checkMention ?? false,
    replyInstructions: input.replyInstructions,
  });

  return {
    outcome: result.outcome,
    category: result.triage?.category,
    drafted: result.evaluations.length > 0,
    body: result.body,
    citations: result.citations,
    reasons: result.reasons,
    revisions: result.revisions,
    rejectedDrafts: result.evaluations.flatMap((entry) => (entry.pass ? [] : entry.issues)),
    trace,
  };
};
