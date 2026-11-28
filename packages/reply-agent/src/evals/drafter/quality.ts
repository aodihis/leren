import { EvalOutcome, createEvalTypes, runEvalCli } from "@anvia/core/evals";
import { reporters } from "../observer";
import { gradeNoInternalReferences, gradeOutcome, gradeValidJson } from "./graders";
import type { Verdict } from "./graders";
import { createBehaviourJudge, createCitationJudge, createFaithfulness } from "./judge";
import type { JudgeExpectation } from "./judge";
import { getJudgeModel } from "./models";
import { qualityCases } from "./quality-cases";
import { target } from "./target";
import type { DrafterInput, DrafterOutput } from "./target";

const { defineMetric } = createEvalTypes<DrafterInput, DrafterOutput, JudgeExpectation>();

const toOutcome = (verdict: Verdict) =>
  verdict.pass
    ? EvalOutcome.pass(true, verdict.comment ? { comment: verdict.comment } : undefined)
    : EvalOutcome.fail(false, { comment: verdict.comment });

const judgeModel = await getJudgeModel();

/** The case ids that `EVAL_CASES` names, separated by commas. Without it, every case runs. */
const only = process.env.EVAL_CASES?.split(",")
  .map((id) => id.trim())
  .filter(Boolean);

const unknown = only?.filter((id) => !qualityCases.some((testCase) => testCase.id === id)) ?? [];

if (unknown.length > 0) {
  throw new Error(`Unknown eval cases: ${unknown.join(", ")}`);
}

await runEvalCli({
  name: "drafter-quality",
  cases: only?.length
    ? qualityCases.filter((testCase) => only.includes(testCase.id))
    : qualityCases,
  target,
  reporters,
  concurrency: 1,
  exitCode: true,
  metrics: [
    defineMetric({
      name: "valid-json",
      dataType: "BOOLEAN",
      evaluate: ({ output }) => toOutcome(gradeValidJson(output)),
    }),
    defineMetric({
      name: "outcome",
      dataType: "BOOLEAN",
      evaluate: ({ case: testCase, output }) =>
        toOutcome(gradeOutcome(output, testCase.expected?.outcome ?? "answer")),
    }),
    defineMetric({
      name: "no-internal-references",
      dataType: "BOOLEAN",
      evaluate: ({ output }) => toOutcome(gradeNoInternalReferences(output)),
    }),
    createBehaviourJudge(judgeModel),
    createFaithfulness(judgeModel),
    createCitationJudge(judgeModel),
  ],
});
