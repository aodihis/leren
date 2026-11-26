import { runEvalCli } from "@anvia/core/evals";
import { createRubricJudge, toolCallsMetric } from "./judge";
import { llmJudgeCases } from "./llm-judge-cases";
import { getJudgeModel } from "./models";
import { reporters, target } from "./target";

await runEvalCli({
  name: "llm-judge",
  cases: llmJudgeCases,
  target,
  reporters,
  concurrency: 1,
  metrics: [createRubricJudge("behaviour", await getJudgeModel()), toolCallsMetric],
  exitCode: true,
});
