import { EvalOutcome, createEvalTypes, runEvalCli } from "@anvia/core/evals";
import { reporters } from "../observer";
import { contentCases } from "./content-cases";
import type { ContentExpectation } from "./content-cases";
import {
  gradeCitesExpected,
  gradeDraftChecks,
  gradeForbiddenContent,
  gradeOutcome,
  gradeRequiredFacts,
  gradeValidJson,
} from "./graders";
import type { Verdict } from "./graders";
import { target } from "./target";
import type { DrafterInput, DrafterOutput } from "./target";

const { defineMetric } = createEvalTypes<DrafterInput, DrafterOutput, ContentExpectation>();

const toOutcome = (verdict: Verdict) =>
  verdict.pass
    ? EvalOutcome.pass(true, verdict.comment ? { comment: verdict.comment } : undefined)
    : EvalOutcome.fail(false, { comment: verdict.comment });

await runEvalCli({
  name: "drafter-content",
  cases: contentCases,
  target,
  reporters,
  concurrency: 2,
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
      name: "draft-checks",
      dataType: "BOOLEAN",
      evaluate: ({ output }) => toOutcome(gradeDraftChecks(output)),
    }),
    defineMetric({
      name: "cites-expected",
      dataType: "BOOLEAN",
      evaluate: ({ case: testCase, output }) =>
        toOutcome(gradeCitesExpected(output, testCase.expected?.cites ?? [])),
    }),
    defineMetric({
      name: "required-facts",
      dataType: "BOOLEAN",
      evaluate: ({ case: testCase, output }) =>
        toOutcome(gradeRequiredFacts(output, testCase.expected?.mustInclude ?? [])),
    }),
    defineMetric({
      name: "forbidden-content",
      dataType: "BOOLEAN",
      evaluate: ({ case: testCase, output }) =>
        toOutcome(gradeForbiddenContent(output, testCase.expected?.mustNotInclude ?? [])),
    }),
  ],
});
