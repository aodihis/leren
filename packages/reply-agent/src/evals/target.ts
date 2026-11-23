import type { EvalTarget } from "@anvia/core/evals";
import { loadHarness } from "@leren/agents";
import { createObserver } from "@leren/observability";
import { runReplyPipeline } from "../pipeline";
import type { Outcome, Playbook, ReplyPipelineDeps, Retrieval } from "../pipeline";

const harness = await loadHarness();
const observer = createObserver();

/** The models, prompt and observer that every eval case shares. */
export const sharedDeps = {
  models: {
    triage: harness.createModel("replyTriage"),
    draft: harness.createModel("reply"),
    judge: harness.createModel("replyJudge"),
  },
  rules: await harness.readPrompt("reply"),
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
  body: string | undefined;
  citations: readonly string[];
  reasons: readonly string[];
  revisions: number;
};

/** What a case expects. Only the fields that are set are checked. */
export type ReplyExpectation = {
  outcome: Outcome;
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
  return { restrictions: "", contacts: [], examples: [], ...fields };
}

export const reporters = [observer.evalReporter()].filter((reporter) => reporter !== undefined);

/**
 * Runs the real reply pipeline, with the production prompt and models, against fixed playbooks
 * instead of the MCP server, so that a case controls exactly what retrieval returns. Call
 * `closeTarget` when all evals have finished so that traces are flushed.
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

  const result = await runReplyPipeline(deps, {
    messageId: "eval",
    email: input.email,
    checkMention: input.checkMention ?? false,
    replyInstructions: input.replyInstructions,
  });

  return {
    outcome: result.outcome,
    body: result.body,
    citations: result.citations,
    reasons: result.reasons,
    revisions: result.revisions,
  };
};

/** Flushes the traces that the target's observer collected. */
export async function closeTarget(): Promise<void> {
  await observer.close();
}
