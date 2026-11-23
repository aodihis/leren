import { EvalOutcome, createEvalTypes, runEvalCli } from "@anvia/core/evals";
import { pipelineCases } from "./pipeline-cases";
import { reporters, target } from "./target";
import type { ReplyEvalInput, ReplyEvalOutput, ReplyExpectation } from "./target";

const { defineMetric } = createEvalTypes<ReplyEvalInput, ReplyEvalOutput, ReplyExpectation>();

const includes = (text: string | undefined, part: string) =>
  (text ?? "").toLowerCase().includes(part.toLowerCase());

/**
 * Passes when the pipeline ended in the expected outcome. For a case without knowledge this is the
 * correct abstention, and for a restriction it is the correct escalation.
 */
const outcome = defineMetric({
  name: "outcome",
  dataType: "BOOLEAN",
  evaluate({ case: testCase, output }) {
    return output.outcome === testCase.expected?.outcome
      ? EvalOutcome.pass(true)
      : EvalOutcome.fail(false, {
          comment: `Expected ${testCase.expected?.outcome}, got ${output.outcome}. Reasons: ${output.reasons.join(" | ")}`,
        });
  },
});

/** Passes when the body has every required text and none of the forbidden texts. */
const content = defineMetric({
  name: "content",
  dataType: "BOOLEAN",
  evaluate({ case: testCase, output }) {
    const missing = (testCase.expected?.mustInclude ?? []).filter(
      (part) => !includes(output.body, part),
    );

    const forbidden = (testCase.expected?.mustNotInclude ?? []).filter((part) =>
      includes(output.body, part),
    );

    return missing.length === 0 && forbidden.length === 0
      ? EvalOutcome.pass(true)
      : EvalOutcome.fail(false, {
          comment: `Missing: [${missing.join(", ")}]. Forbidden but present: [${forbidden.join(", ")}]`,
        });
  },
});

/** Passes when every citation is a playbook that the case allows. */
const citations = defineMetric({
  name: "citations",
  dataType: "BOOLEAN",
  evaluate({ case: testCase, output }) {
    const allowed = testCase.expected?.citeWithin;
    const outside = allowed ? output.citations.filter((id) => !allowed.includes(id)) : [];

    return outside.length === 0
      ? EvalOutcome.pass(true)
      : EvalOutcome.fail(false, {
          comment: `Cited outside the allowed playbooks: [${outside.join(", ")}]`,
        });
  },
});

await runEvalCli({
  name: "pipeline",
  cases: pipelineCases,
  target,
  reporters,
  concurrency: 1,
  metrics: [outcome, content, citations],
  exitCode: true,
});
