import { runEvalCli } from "@anvia/core/evals";
import { clarificationCases } from "./clarification-cases";
import { createRubricJudge, storeSizeMetric, toolCallsMetric } from "./judge";
import { getJudgeModel } from "./models";
import { reporters, target } from "./target";

await runEvalCli({
  name: "clarification",
  cases: clarificationCases,
  target,
  reporters,
  concurrency: 1,
  metrics: [
    createRubricJudge("clarification", await getJudgeModel()),
    toolCallsMetric,
    storeSizeMetric,
  ],
  exitCode: true,
});
