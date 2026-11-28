import { EvalOutcome, createEvalTypes, runEvalCli } from "@anvia/core/evals";
import { reporters } from "../observer";
import { deterministicCases } from "./deterministic-cases";
import type { PipelineExpectation } from "./deterministic-cases";
import {
  gradeCategory,
  gradeCitations,
  gradeConfidence,
  gradeEscalation,
  gradeFlags,
  gradeForbiddenContent,
  gradeOnlyReadable,
  gradeOutcome,
  gradeQuestionCount,
  gradeRequiredFacts,
  gradeSteps,
} from "./graders";
import type { Verdict } from "./graders";
import { target } from "./target";
import type { PipelineCaseInput, PipelineCaseOutput } from "./target";

const { defineMetric } = createEvalTypes<
  PipelineCaseInput,
  PipelineCaseOutput,
  PipelineExpectation
>();

const toOutcome = (verdict: Verdict) =>
  verdict.pass
    ? EvalOutcome.pass(true, verdict.comment ? { comment: verdict.comment } : undefined)
    : EvalOutcome.fail(false, { comment: verdict.comment });

/** The expectation of a case. Every pipeline case has one. */
function expectationOf(testCase: { id: string; expected?: PipelineExpectation }) {
  if (!testCase.expected) {
    throw new Error(`The case ${testCase.id} has no expectation.`);
  }

  return testCase.expected;
}

/** The case ids that `EVAL_CASES` names, separated by commas. Without it, every case runs. */
const only = process.env.EVAL_CASES?.split(",")
  .map((id) => id.trim())
  .filter(Boolean);

const unknown =
  only?.filter((id) => !deterministicCases.some((testCase) => testCase.id === id)) ?? [];

if (unknown.length > 0) {
  throw new Error(`Unknown eval cases: ${unknown.join(", ")}`);
}

await runEvalCli({
  name: "pipeline-deterministic",
  cases: only?.length
    ? deterministicCases.filter((testCase) => only.includes(testCase.id))
    : deterministicCases,
  target,
  reporters,
  concurrency: 2,
  exitCode: true,
  metrics: [
    defineMetric({
      name: "triage-category",
      dataType: "BOOLEAN",
      evaluate: ({ case: testCase, output }) =>
        toOutcome(gradeCategory(output, expectationOf(testCase).triage.category)),
    }),
    defineMetric({
      name: "triage-questions",
      dataType: "BOOLEAN",
      evaluate: ({ case: testCase, output }) =>
        toOutcome(gradeQuestionCount(output, expectationOf(testCase).triage.questions)),
    }),
    defineMetric({
      name: "triage-flags",
      dataType: "BOOLEAN",
      evaluate: ({ case: testCase, output }) =>
        toOutcome(gradeFlags(output, expectationOf(testCase).triage)),
    }),
    defineMetric({
      name: "triage-confidence",
      dataType: "BOOLEAN",
      evaluate: ({ case: testCase, output }) =>
        toOutcome(gradeConfidence(output, expectationOf(testCase).triage.confident)),
    }),
    defineMetric({
      name: "outcome",
      dataType: "BOOLEAN",
      evaluate: ({ case: testCase, output }) =>
        toOutcome(gradeOutcome(output, expectationOf(testCase).outcome)),
    }),
    defineMetric({
      name: "citations",
      dataType: "BOOLEAN",
      evaluate: ({ case: testCase, output }) =>
        toOutcome(gradeCitations(output, expectationOf(testCase).cites)),
    }),
    defineMetric({
      name: "only-readable-playbooks",
      dataType: "BOOLEAN",
      evaluate: ({ output }) => toOutcome(gradeOnlyReadable(output)),
    }),
    defineMetric({
      name: "required-facts",
      dataType: "BOOLEAN",
      evaluate: ({ case: testCase, output }) =>
        toOutcome(gradeRequiredFacts(output, expectationOf(testCase).mustInclude ?? [])),
    }),
    defineMetric({
      name: "forbidden-content",
      dataType: "BOOLEAN",
      evaluate: ({ case: testCase, output }) =>
        toOutcome(gradeForbiddenContent(output, expectationOf(testCase).mustNotInclude ?? [])),
    }),
    defineMetric({
      name: "escalation-reason",
      dataType: "BOOLEAN",
      evaluate: ({ output }) => toOutcome(gradeEscalation(output)),
    }),
    defineMetric({
      name: "steps",
      dataType: "BOOLEAN",
      evaluate: ({ case: testCase, output }) =>
        toOutcome(gradeSteps(output, expectationOf(testCase).style)),
    }),
  ],
});
