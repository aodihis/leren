import {
  EvalOutcome,
  containsAny,
  createEvalTypes,
  doesNotMatch,
  runEvalCli,
} from "@anvia/core/evals";
import { emptyPlaybooksCases } from "./empty-playbooks-cases";
import type { EmptyExpectation } from "./empty-playbooks-cases";
import { NOTHING_FOUND_PATTERNS, anyOf, gradeReadsAndKeepsEmpty } from "./graders";
import { reporters, target } from "./target";
import type { AssistantEvalInput, AssistantEvalOutput } from "./target";

const { defineMetric } = createEvalTypes<
  AssistantEvalInput,
  AssistantEvalOutput,
  EmptyExpectation
>();

const readsAndKeepsEmpty = defineMetric({
  name: "reads-and-keeps-store-empty",
  dataType: "BOOLEAN",
  evaluate({ output }) {
    const verdict = gradeReadsAndKeepsEmpty(output);

    return verdict.pass
      ? EvalOutcome.pass(true)
      : EvalOutcome.fail(false, { comment: verdict.comment });
  },
});

await runEvalCli({
  name: "empty-playbooks",
  cases: emptyPlaybooksCases,
  target,
  reporters,
  concurrency: 2,
  metrics: [
    readsAndKeepsEmpty,
    containsAny<AssistantEvalInput, AssistantEvalOutput, EmptyExpectation>({
      name: "says-nothing-was-found",
      actual: ({ output }) => output.text,
      expected: NOTHING_FOUND_PATTERNS,
    }),
    doesNotMatch<AssistantEvalInput, AssistantEvalOutput, EmptyExpectation>({
      name: "invents-no-details",
      actual: ({ output }) => output.text,
      expected: ({ case: testCase }) => anyOf(testCase.expected?.excludes ?? []),
    }),
  ],
  exitCode: true,
});
