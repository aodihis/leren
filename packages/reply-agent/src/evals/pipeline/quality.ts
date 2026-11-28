import { EvalOutcome, createEvalTypes, runEvalCli } from "@anvia/core/evals";
import { getJudgeModel } from "./models";
import { reporters } from "../observer";
import { gradeCitations, gradeOutcome } from "./graders";
import type { Verdict } from "./graders";
import { createBehaviourJudge, createCitationJudge, createFaithfulness } from "./judge";
import type { QualityExpectation } from "./judge";
import { qualityCases } from "./quality-cases";
import { target } from "./target";
import type { PipelineCaseInput, PipelineCaseOutput } from "./target";

const { defineMetric } = createEvalTypes<
  PipelineCaseInput,
  PipelineCaseOutput,
  QualityExpectation
>();

const toOutcome = (verdict: Verdict) =>
  verdict.pass
    ? EvalOutcome.pass(true, verdict.comment ? { comment: verdict.comment } : undefined)
    : EvalOutcome.fail(false, { comment: verdict.comment });

/** The expectation of a case. Every quality case has one. */
function expectationOf(testCase: { id: string; expected?: QualityExpectation }) {
  if (!testCase.expected) {
    throw new Error(`The case ${testCase.id} has no expectation.`);
  }

  return testCase.expected;
}

const judgeModel = await getJudgeModel();

/** The case ids that `EVAL_CASES` names, separated by commas. Without it, every case runs. */
const only = process.env.EVAL_CASES?.split(",")
  .map((id) => id.trim())
  .filter(Boolean);

const unknown = only?.filter((id) => !qualityCases.some((testCase) => testCase.id === id)) ?? [];

if (unknown.length > 0) {
  throw new Error(`Unknown eval cases: ${unknown.join(", ")}`);
}

await runEvalCli<PipelineCaseInput, PipelineCaseOutput, QualityExpectation>({
  name: "pipeline-quality",
  cases: only?.length
    ? qualityCases.filter((testCase) => only.includes(testCase.id))
    : qualityCases,
  target,
  reporters,
  concurrency: 1,
  exitCode: true,
  metrics: [
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
    createBehaviourJudge(judgeModel),
    createFaithfulness(judgeModel),
    createCitationJudge(judgeModel),
  ],
});
