import { EvalOutcome, createEvalTypes, runEvalCli } from "@anvia/core/evals";
import { reporters } from "../observer";
import {
  gradeKnownIds,
  gradeNoWriteToolsOffered,
  gradeOnlyReadCalls,
  gradeSearchBudget,
  gradeSearchedEachQuestion,
  gradeWithinTurns,
} from "./graders";
import type { Verdict } from "./graders";
import { target } from "./target";
import type { DrafterInput, DrafterOutput } from "./target";
import { toolCallsCases } from "./tool-calls-cases";
import type { ToolCallExpectation } from "./tool-calls-cases";

const { defineMetric } = createEvalTypes<DrafterInput, DrafterOutput, ToolCallExpectation>();

const toOutcome = (verdict: Verdict) =>
  verdict.pass
    ? EvalOutcome.pass(true, verdict.comment ? { comment: verdict.comment } : undefined)
    : EvalOutcome.fail(false, { comment: verdict.comment });

await runEvalCli({
  name: "drafter-tool-calls",
  cases: toolCallsCases,
  target,
  reporters,
  concurrency: 2,
  exitCode: true,
  metrics: [
    defineMetric({
      name: "no-write-tools-available",
      dataType: "BOOLEAN",
      evaluate: ({ output }) => toOutcome(gradeNoWriteToolsOffered(output)),
    }),
    defineMetric({
      name: "only-read-tools-called",
      dataType: "BOOLEAN",
      evaluate: ({ output }) => toOutcome(gradeOnlyReadCalls(output)),
    }),
    defineMetric({
      name: "searched-each-question",
      dataType: "BOOLEAN",
      evaluate: ({ case: testCase, output }) =>
        toOutcome(gradeSearchedEachQuestion(testCase.input, output)),
    }),
    defineMetric({
      name: "search-budget",
      dataType: "BOOLEAN",
      evaluate: ({ case: testCase, output }) =>
        toOutcome(gradeSearchBudget(output, testCase.expected?.maxSearches)),
    }),
    defineMetric({
      name: "get-playbook-known-id",
      dataType: "BOOLEAN",
      evaluate: ({ output }) => toOutcome(gradeKnownIds(output)),
    }),
    defineMetric({
      name: "within-turn-limit",
      dataType: "BOOLEAN",
      evaluate: ({ output }) => toOutcome(gradeWithinTurns(output)),
    }),
  ],
});
