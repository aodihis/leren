import { EvalOutcome, createEvalTypes, llmJudge } from "@anvia/core/evals";
import type { CompletionModel } from "@anvia/core";
import { z } from "zod";
import { gradeStoreSize, gradeToolCalls, gradeWrite } from "./graders";
import type { ToolExpectation, WriteExpectation } from "./graders";
import type { AssistantEvalInput, AssistantEvalOutput } from "./target";

/**
 * What a judged case expects. `criteria` states the right behaviour, `reference` is an answer that
 * is known to be correct, `tools` limits the tool calls and `write` is the one write that the
 * run must make.
 */
export type JudgeExpectation = {
  criteria: string;
  reference?: string;
  tools?: ToolExpectation;
  write?: WriteExpectation;
  /** The number of playbooks that the store must hold after the run. */
  playbooksAfter?: number;
};

const { defineMetric } = createEvalTypes<
  AssistantEvalInput,
  AssistantEvalOutput,
  JudgeExpectation
>();

const verdictSchema = z.object({
  reason: z.string().describe("One or two sentences that justify the verdict."),
  passes: z.boolean().describe("True only when the answer meets every part of the criteria."),
});

/**
 * Builds a judge that grades the answer against the criteria of the case, and against the
 * reference when the case has one. The judge sees the conversation, the tools that were called and
 * the answer, and it never learns whether a case is meant to be good or bad.
 */
export function createRubricJudge(name: string, model: CompletionModel) {
  return llmJudge<
    AssistantEvalInput,
    AssistantEvalOutput,
    z.infer<typeof verdictSchema>,
    JudgeExpectation
  >({
    name,
    model,
    schema: verdictSchema,
    passes: (verdict) => verdict.passes,
    retries: 2,
    instructions:
      "You grade the answer of an assistant against written criteria. Judge only against the criteria and the reference, not against your own opinion of a good answer. Be strict: if one part of the criteria is not met, the answer does not pass. Tool calls tell you what the assistant did, so an answer that claims an action that no tool call performed does not pass.",
    prompt: ({ case: testCase, output }) =>
      [
        `Conversation:\n${testCase.input.conversation.map((turn) => `${turn.role}: ${turn.content}`).join("\n")}`,
        `Tools that the assistant called: ${JSON.stringify(output.toolCalls.map((call) => ({ name: call.name, input: call.input })))}`,
        `Assistant's answer:\n${output.text}`,
        `Criteria:\n${testCase.expected?.criteria}`,
        testCase.expected?.reference
          ? `Reference, which is known to be correct:\n${testCase.expected.reference}`
          : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
  });
}

/** Passes when the tool calls follow the `tools` expectation of the case. */
export const toolCallsMetric = defineMetric({
  name: "tool-calls",
  dataType: "BOOLEAN",
  evaluate({ case: testCase, output }) {
    const verdict = gradeToolCalls(output.toolCalls, testCase.expected?.tools);

    return verdict.pass
      ? EvalOutcome.pass(true)
      : EvalOutcome.fail(false, { comment: verdict.comment });
  },
});

/** Passes when the run made the one write that the case expects, with the right arguments. */
export const writeMetric = defineMetric({
  name: "write-arguments",
  dataType: "BOOLEAN",
  evaluate({ case: testCase, output }) {
    const verdict = gradeWrite(output.toolCalls, testCase.expected?.write);

    return verdict.pass
      ? EvalOutcome.pass(true)
      : EvalOutcome.fail(false, { comment: verdict.comment });
  },
});

/** Passes when the store holds the number of playbooks that the case expects after the run. */
export const storeSizeMetric = defineMetric({
  name: "store-size",
  dataType: "BOOLEAN",
  evaluate({ case: testCase, output }) {
    const verdict = gradeStoreSize(output, testCase.expected?.playbooksAfter);

    return verdict.pass
      ? EvalOutcome.pass(true)
      : EvalOutcome.fail(false, { comment: verdict.comment });
  },
});
