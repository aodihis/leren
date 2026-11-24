import { EvalOutcome, createEvalTypes, runEvalCli } from "@anvia/core/evals";
import type { AssistantEvalInput, AssistantEvalOutput } from "./target";
import { reporters, target } from "./target";
import { toolUseCases } from "./tool-use-cases";
import type { ToolExpectation } from "./tool-use-cases";

const { defineMetric } = createEvalTypes<
  AssistantEvalInput,
  AssistantEvalOutput,
  ToolExpectation
>();

/** Passes when required and forbidden tools match. */
const toolUse = defineMetric({
  name: "tool-use",
  dataType: "BOOLEAN",
  evaluate({ case: testCase, output }) {
    const names = output.toolCalls.map((call) => call.name);

    const matches = (pattern: string) =>
      names.some((name) => new RegExp(`^(${pattern})$`).test(name));

    const missing = (testCase.expected?.mustCall ?? []).filter((pattern) => !matches(pattern));
    const forbidden = (testCase.expected?.mustNotCall ?? []).filter(matches);

    return missing.length === 0 && forbidden.length === 0
      ? EvalOutcome.pass(true)
      : EvalOutcome.fail(false, {
          comment: `Missing: [${missing.join(", ")}]. Forbidden but called: [${forbidden.join(", ")}]. Called: [${names.join(", ")}]`,
        });
  },
});

await runEvalCli({
  name: "tool-use",
  cases: toolUseCases,
  target,
  reporters,
  concurrency: 2,
  metrics: [toolUse],
  exitCode: true,
});
