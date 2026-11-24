import { EvalOutcome, createEvalTypes, runEvalCli } from "@anvia/core/evals";
import type { EvalTarget } from "@anvia/core/evals";
import { CRITERIA, judge } from "../../pipeline";
import { judgeCases } from "./judge-cases";
import type { JudgeEvalInput, JudgeExpectation } from "./judge-cases";
import { reporters } from "../observer";
import { sharedDeps } from "../pipeline/target";

/** What the judge decided for one draft. */
type JudgeEvalOutput = { pass: boolean; failed: readonly string[]; feedback: string };

const target: EvalTarget<JudgeEvalInput, JudgeEvalOutput> = async (input, _testCase, context) => {
  const verdict = await judge(
    {
      ...sharedDeps,
      retrieve: async () => ({ status: "no_reliable_result" }),
      abortSignal: context?.signal,
    },
    input,
  );

  const failed = CRITERIA.filter((criterion) => !verdict[criterion]);

  return { pass: failed.length === 0, failed, feedback: verdict.feedback };
};

const { defineMetric } = createEvalTypes<JudgeEvalInput, JudgeEvalOutput, JudgeExpectation>();

/**
 * Passes when the judge agrees with the label of the person. The pass rate of this metric is the
 * calibration of the judge, so a drop means that the evaluator of the pipeline cannot be trusted.
 */
const agreement = defineMetric({
  name: "judge-agreement",
  dataType: "BOOLEAN",
  evaluate({ case: testCase, output }) {
    return output.pass === testCase.expected?.pass
      ? EvalOutcome.pass(true)
      : EvalOutcome.fail(false, {
          comment: `Label ${testCase.expected?.pass}, judge ${output.pass}. Failed: [${output.failed.join(", ")}]. ${output.feedback}`,
        });
  },
});

await runEvalCli({
  name: "judge",
  cases: judgeCases,
  target,
  reporters,
  concurrency: 1,
  metrics: [agreement],
  exitCode: true,
});
