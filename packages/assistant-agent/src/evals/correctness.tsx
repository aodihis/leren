import { runEvalCli } from "@anvia/core/evals";
import { correctnessCases } from "./correctness-cases";
import { createRubricJudge, toolCallsMetric, writeMetric } from "./judge";
import { getJudgeModel } from "./models";
import { reporters, target } from "./target";

await runEvalCli({
  name: "correctness",
  cases: correctnessCases,
  target,
  reporters,
  concurrency: 1,
  metrics: [createRubricJudge("correctness", await getJudgeModel()), toolCallsMetric, writeMetric],
  exitCode: true,
});
