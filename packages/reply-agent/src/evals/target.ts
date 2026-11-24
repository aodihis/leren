import type { EvalTarget } from "@anvia/core/evals";
import { loadHarness } from "@leren/agents";
import { createObserver } from "@leren/observability";
import { runReplyPipeline } from "../pipeline";
import type { Category, Outcome, Playbook, ReplyPipelineDeps, Retrieval } from "../pipeline";

const harness = await loadHarness();
const observer = createObserver();

/** The models, prompt and observer all cases share. */
export const sharedDeps = {
  models: {
    triage: harness.createModel("replyTriage"),
    draft: harness.createModel("reply"),
    judge: harness.createModel("replyJudge"),
  },
  rules: await harness.readPrompt("reply"),
  observer,
};

/** The input of one eval case. */
export type ReplyEvalInput = {
  email: { from: string; subject: string; body: string };
  /** What retrieval returns. */
  playbooks: readonly Playbook[];
  checkMention?: boolean;
  replyInstructions?: string;
};

/** What the pipeline produced for one case. */
export type ReplyEvalOutput = {
  outcome: Outcome;
  /** The category that triage chose, if any. */
  category: Category | undefined;
  /** Whether the drafting agent ran. */
  drafted: boolean;
  body: string | undefined;
  citations: readonly string[];
  reasons: readonly string[];
  revisions: number;
};

/** What a case expects. */
export type ReplyExpectation = {
  /** The outcomes that the pipeline may reach. */
  outcome: Outcome | readonly Outcome[];
  /** The category that triage must choose. */
  category?: Category;
  /** Substrings that the body must contain. */
  mustInclude?: readonly string[];
  /** Substrings that the body must not contain. */
  mustNotInclude?: readonly string[];
  /** The playbook ids that citations must stay within. */
  citeWithin?: readonly string[];
};

/** Builds a playbook fixture. */
export function playbook(
  fields: Pick<Playbook, "id" | "topic" | "response"> & Partial<Playbook>,
): Playbook {
  return { restrictions: "", examples: [], ...fields };
}

export const reporters = [observer.evalReporter()].filter((reporter) => reporter !== undefined);

/** Runs the real reply pipeline over fixed playbooks. */
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
    category: result.triage?.category,
    drafted: result.evaluations.length > 0,
    body: result.body,
    citations: result.citations,
    reasons: result.reasons,
    revisions: result.revisions,
  };
};

/** Flushes the collected traces. */
export async function closeTarget(): Promise<void> {
  await observer.close();
}
