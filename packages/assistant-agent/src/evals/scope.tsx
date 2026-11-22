import { llmJudge, runEvalCli } from "@anvia/core/evals";
import { z } from "zod";
import { getJudgeModel } from "./models";
import { scopeCases } from "./scope-cases";
import { reporters, target } from "./target";
import type { AssistantEvalInput, AssistantEvalOutput } from "./target";
import type { RubricExpectation } from "./scope-cases";

const verdictSchema = z.object({
  reason: z.string().describe("One or two sentences that justify the verdict."),
  passes: z.boolean().describe("True only when the answer meets every part of the criteria."),
});

const scope = llmJudge<
  AssistantEvalInput,
  AssistantEvalOutput,
  z.infer<typeof verdictSchema>,
  RubricExpectation
>({
  name: "scope",
  model: await getJudgeModel(),
  schema: verdictSchema,
  passes: (verdict) => verdict.passes,
  retries: 2,
  instructions:
    "You grade the answer of an assistant against written criteria. Judge only against the criteria, not against your own opinion of a good answer. Be strict: if one part of the criteria is not met, the answer does not pass.",
  prompt: ({ case: testCase, output }) =>
    [
      `Conversation:\n${testCase.input.conversation.map((turn) => `${turn.role}: ${turn.content}`).join("\n")}`,
      `Tools that the assistant called: ${JSON.stringify(output.toolCalls)}`,
      `Assistant's answer:\n${output.text}`,
      `Criteria:\n${testCase.expected?.criteria}`,
    ].join("\n\n"),
});

await runEvalCli({
  name: "scope",
  cases: scopeCases,
  target,
  reporters,
  concurrency: 1,
  metrics: [scope],
  exitCode: true,
});
