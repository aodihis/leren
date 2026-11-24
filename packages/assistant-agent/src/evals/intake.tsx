import { EvalOutcome, createEvalTypes, llmJudge, runEvalCli } from "@anvia/core/evals";
import { z } from "zod";
import { intakeCases } from "./intake-cases";
import type { RubricExpectation } from "./intake-cases";
import { getJudgeModel } from "./models";
import { reporters, target } from "./target";
import type { AssistantEvalInput, AssistantEvalOutput } from "./target";

const verdictSchema = z.object({
  reason: z.string().describe("One or two sentences that justify the verdict."),
  passes: z.boolean().describe("True only when the answer meets every part of the criteria."),
});

const { defineMetric } = createEvalTypes<
  AssistantEvalInput,
  AssistantEvalOutput,
  RubricExpectation
>();

const intake = llmJudge<
  AssistantEvalInput,
  AssistantEvalOutput,
  z.infer<typeof verdictSchema>,
  RubricExpectation
>({
  name: "intake",
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

/** Passes when the answer holds no em dash and no semicolon, which the prompt forbids. */
const punctuation = defineMetric({
  name: "no-em-dash-or-semicolon",
  dataType: "BOOLEAN",
  evaluate({ output }) {
    const found = output.text.match(/[—;]/g) ?? [];

    return found.length === 0
      ? EvalOutcome.pass(true)
      : EvalOutcome.fail(false, { comment: `Forbidden characters found: ${found.join(" ")}` });
  },
});

await runEvalCli({
  name: "intake",
  cases: intakeCases,
  target,
  reporters,
  concurrency: 1,
  metrics: [intake, punctuation],
  exitCode: true,
});
