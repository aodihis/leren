import { EvalOutcome, createEvalTypes, runEvalCli } from "@anvia/core/evals";
import { gradeToolCalls } from "./graders";
import type { ToolExpectation } from "./graders";
import { reporters, target } from "./target";
import type { AssistantEvalInput, AssistantEvalOutput } from "./target";
import { toolCallsCases } from "./tool-calls-cases";

const { defineMetric } = createEvalTypes<
  AssistantEvalInput,
  AssistantEvalOutput,
  ToolExpectation
>();

const toolCalls = defineMetric({
  name: "tool-calls",
  dataType: "BOOLEAN",
  evaluate({ case: testCase, output }) {
    const verdict = gradeToolCalls(output.toolCalls, testCase.expected);

    return verdict.pass
      ? EvalOutcome.pass(true)
      : EvalOutcome.fail(false, { comment: verdict.comment });
  },
});

await runEvalCli({
  name: "tool-calls",
  cases: toolCallsCases,
  target,
  reporters,
  concurrency: 2,
  metrics: [toolCalls],
  exitCode: true,
});
