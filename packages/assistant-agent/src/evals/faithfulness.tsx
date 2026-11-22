import { faithfulness, runEvalCli } from "@anvia/core/evals";
import { faithfulnessCases } from "./faithfulness-cases";
import { getJudgeModel } from "./models";
import { reporters, target } from "./target";
import type { AssistantEvalInput, AssistantEvalOutput } from "./target";

await runEvalCli({
  name: "faithfulness",
  cases: faithfulnessCases,
  target,
  reporters,
  concurrency: 1,
  metrics: [
    faithfulness<AssistantEvalInput, AssistantEvalOutput>({
      model: await getJudgeModel(),
      threshold: 0.7,
      includeReason: true,
      retries: 2,
      input: ({ case: testCase }) => testCase.input.conversation.at(-1)?.content ?? "",
      actual: ({ output }) => output.text,
    }),
  ],
  exitCode: true,
  expectations: {
    outcomes: Object.fromEntries(
      faithfulnessCases.map((c) => [c.id, { faithfulness: c.expected.verdict }]),
    ),
  },
});
