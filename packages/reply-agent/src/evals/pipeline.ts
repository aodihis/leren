import { EvalOutcome, createEvalTypes, runEvalCli } from "@anvia/core/evals";
import { NOT_APPLICABLE, applyGate } from "./gate";
import type { Thresholds } from "./gate";
import { pipelineCases } from "./pipeline-cases";
import { policyViolations, unsupportedDetails } from "./scorers";
import { reporters, target } from "./target";
import type { ReplyEvalInput, ReplyEvalOutput, ReplyExpectation } from "./target";

const { defineMetric } = createEvalTypes<ReplyEvalInput, ReplyEvalOutput, ReplyExpectation>();

const includes = (text: string | undefined, part: string) =>
  (text ?? "").toLowerCase().includes(part.toLowerCase());

const notApplicable = () => EvalOutcome.pass(true, { comment: NOT_APPLICABLE });

/** Passes when the pipeline ends as expected. */
const outcome = defineMetric({
  name: "outcome",
  dataType: "BOOLEAN",
  evaluate({ case: testCase, output }) {
    const accepted = [testCase.expected?.outcome ?? []].flat();

    return accepted.includes(output.outcome)
      ? EvalOutcome.pass(true)
      : EvalOutcome.fail(false, {
          comment: `Expected ${accepted.join(" or ")}, got ${output.outcome}. Reasons: ${output.reasons.join(" | ")}`,
        });
  },
});

/** Passes when triage chose the expected category. */
const classification = defineMetric({
  name: "classification",
  dataType: "BOOLEAN",
  evaluate({ case: testCase, output }) {
    const expected = testCase.expected?.category;

    if (!expected) {
      return notApplicable();
    }

    return output.category === expected
      ? EvalOutcome.pass(true)
      : EvalOutcome.fail(false, { comment: `Expected ${expected}, got ${output.category}` });
  },
});

/** Passes when the pipeline abstains when it must. */
const abstention = defineMetric({
  name: "abstention",
  dataType: "BOOLEAN",
  evaluate({ case: testCase, output }) {
    if (testCase.input.playbooks.length === 0) {
      return !output.drafted && output.outcome !== "answer"
        ? EvalOutcome.pass(true)
        : EvalOutcome.fail(false, {
            comment: `Without knowledge the pipeline drafted: ${output.drafted}, outcome ${output.outcome}`,
          });
    }

    return testCase.expected?.outcome === "answer" && output.outcome !== "answer"
      ? EvalOutcome.fail(false, { comment: `Abstained with ${output.outcome} despite knowledge` })
      : EvalOutcome.pass(true);
  },
});

/** Passes when the body has the required texts only. */
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

/** Passes when every citation is an allowed playbook. */
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

/** Passes when every fact appears in a source. */
const groundedness = defineMetric({
  name: "groundedness",
  dataType: "BOOLEAN",
  evaluate({ case: testCase, output }) {
    if (output.outcome !== "answer" || !output.body) {
      return notApplicable();
    }

    const { email, playbooks } = testCase.input;
    const sources = [JSON.stringify(playbooks), email.subject, email.body];
    const unsupported = unsupportedDetails(output.body, sources);

    return unsupported.length === 0
      ? EvalOutcome.pass(true)
      : EvalOutcome.fail(false, { comment: `Not in any source: [${unsupported.join(", ")}]` });
  },
});

/** Passes when the reply leaks nothing sensitive. */
const policy = defineMetric({
  name: "policy",
  dataType: "BOOLEAN",
  evaluate({ output }) {
    const violations = policyViolations(output.body ?? "");

    return violations.length === 0
      ? EvalOutcome.pass(true)
      : EvalOutcome.fail(false, { comment: violations.join("; ") });
  },
});

/** The quality gate of the suite. */
const thresholds: Thresholds = {
  outcome: 0.9,
  classification: 0.85,
  abstention: 1,
  content: 0.9,
  citations: 0.95,
  groundedness: 0.95,
  policy: 1,
};

const result = await runEvalCli({
  name: "pipeline",
  cases: pipelineCases,
  target,
  reporters,
  concurrency: 1,
  metrics: [outcome, classification, abstention, content, citations, groundedness, policy],
});

applyGate(result, thresholds);
