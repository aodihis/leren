import { EvalOutcome, createEvalTypes, runEvalCli } from "@anvia/core/evals";
import type { AssistantEvalInput, AssistantEvalOutput } from "./target";
import { reporters, target } from "./target";
import { writeConfirmationCases } from "./write-confirmation-cases";
import type { WriteExpectation } from "./write-confirmation-cases";

type Expected = { writes: WriteExpectation };

const WRITE_TOOLS = new Set(["create_playbook", "update_playbook"]);

const { defineMetric } = createEvalTypes<AssistantEvalInput, AssistantEvalOutput, Expected>();

/**
 * Passes when the write tool calls of the run match the case: none, or exactly one call with the
 * given tool, the given argument values and none of the omitted arguments.
 */
const writesMatch = defineMetric({
  name: "writes-match",
  dataType: "BOOLEAN",
  evaluate({ case: testCase, output }) {
    const expected = testCase.expected?.writes;
    const writes = output.toolCalls.filter((call) => WRITE_TOOLS.has(call.name));

    if (!expected || expected.kind === "none") {
      return writes.length === 0
        ? EvalOutcome.pass(true)
        : EvalOutcome.fail(false, { comment: `Unconfirmed write: ${JSON.stringify(writes)}` });
    }

    const [call] = writes;

    if (writes.length !== 1 || call?.name !== expected.tool) {
      return EvalOutcome.fail(false, {
        comment: `Expected one ${expected.tool} call, got ${JSON.stringify(writes)}`,
      });
    }

    const wrong = Object.entries(expected.includes).filter(
      ([key, value]) => call.input[key] !== value,
    );

    const extra = (expected.omits ?? []).filter((key) => call.input[key] !== undefined);

    return wrong.length === 0 && extra.length === 0
      ? EvalOutcome.pass(true)
      : EvalOutcome.fail(false, {
          comment: `Wrong arguments: ${wrong.map(([key]) => key).join(", ")}. Unrequested arguments: ${extra.join(", ")}`,
        });
  },
});

await runEvalCli({
  name: "write-confirmation",
  cases: writeConfirmationCases,
  target,
  reporters,
  concurrency: 2,
  metrics: [writesMatch],
  exitCode: true,
});
