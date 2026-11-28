import type { CompletionModel } from "@anvia/core";
import { EvalOutcome, llmJudge } from "@anvia/core/evals";
import { NOT_APPLICABLE } from "@leren/evals";
import { z } from "zod";
import { keepAllowed } from "../../pipeline/playbooks";
import { renderPlaybooks } from "../../pipeline/prompts";
import type { Outcome } from "../../pipeline/types";
import type { PipelineCaseInput, PipelineCaseOutput } from "./target";

/**
 * What a judged pipeline case expects. `outcome` is the outcome, or the outcomes, that are right for
 * the case, `cites` the exact playbook ids that an answer must cite, and `criteria` the right
 * behaviour of an answer in words that the judge grades against.
 */
export type QualityExpectation = {
  outcome: Exclude<Outcome, "ignore"> | readonly Exclude<Outcome, "ignore">[];
  cites?: readonly string[];
  criteria: string;
};

type Args = {
  case: { input: PipelineCaseInput; expected?: QualityExpectation | undefined };
  output: PipelineCaseOutput;
};

const verdictSchema = z.object({
  reason: z.string().describe("One or two sentences that justify the verdict."),
  passes: z.boolean().describe("True only when the reply meets every part of the criteria."),
});

/**
 * What the reply may say besides the facts of the playbooks. Every judge receives it, so they all
 * agree that only the body reaches the sender and on which follow-ups are supported.
 */
const ALLOWED_STATEMENTS =
  "Only the body is sent to the sender. The reasons are internal notes for the user and are not part of the reply. Besides the facts of the playbooks, the body may greet the sender by name, restate what the sender wrote in the email, and follow the reply instructions of the user, such as a language or a sign-off, and none of these is an unsupported fact. A follow-up sentence, such as that the sender will get an answer later, that someone will get back to them, or an invitation such as 'Let me know if anything else is needed', is supported only when a playbook or the reply instructions of the user give it.";

/** Renders the case and the pipeline's final reply for a judge. The playbooks are the only source of truth. */
function renderRun({ case: testCase, output }: Args): string {
  const { input } = testCase;
  const { result } = output;

  const readable = keepAllowed(
    input.playbooks,
    input.allowedPlaybookIds && new Set(input.allowedPlaybookIds),
  );

  return [
    `Email from ${input.email.from}, subject "${input.email.subject}":\n${input.email.body}`,
    `Playbooks that the assistant could read, the only source of truth:\n${renderPlaybooks(readable)}`,
    `Reply instructions of the user: ${input.replyInstructions ?? "none"}`,
    `Final reply:\n${JSON.stringify({ outcome: result.outcome, reasons: result.reasons, body: result.body, citations: result.citations }, null, 2)}`,
  ].join("\n\n");
}

/**
 * Whether the run ended in an answer. The judges apply only to an answer: an escalation or an
 * ignored message has no body, and the outcome metric grades it.
 */
const isAnswer = (output: PipelineCaseOutput) => output.result.outcome === "answer";

/**
 * Builds the judge that grades the final reply against the criteria of the case. The judge never
 * learns whether a case is meant to be good or bad.
 */
export function createBehaviourJudge(model: CompletionModel) {
  const judge = llmJudge<
    PipelineCaseInput,
    PipelineCaseOutput,
    z.infer<typeof verdictSchema>,
    QualityExpectation
  >({
    name: "behaviour",
    model,
    schema: verdictSchema,
    passes: (verdict) => verdict.passes,
    retries: 2,
    instructions: `You grade an assistant that replies to an email from the user's playbooks. Judge only against the criteria and the playbooks, not against your own opinion of a good reply. Do not require details that the criteria do not ask for, such as a weekday when the date is given. Tone and style do not matter unless the criteria name them. Be strict: if one part of the criteria is not met, the reply does not pass. A fact in the body that no playbook states is a failure, even when it is plausible. ${ALLOWED_STATEMENTS}`,
    prompt: (args) => `${renderRun(args)}\n\nCriteria:\n${args.case.expected?.criteria ?? ""}`,
  });

  return {
    ...judge,
    evaluate: (args: Parameters<typeof judge.evaluate>[0]) =>
      isAnswer(args.output)
        ? judge.evaluate(args)
        : EvalOutcome.pass({ reason: NOT_APPLICABLE, passes: true }, { comment: NOT_APPLICABLE }),
  };
}

/**
 * Builds the judge that checks the citations of a reply: every cited playbook supports part of the
 * body, and every fact in the body comes from a cited playbook.
 */
export function createCitationJudge(model: CompletionModel) {
  const judge = llmJudge<
    PipelineCaseInput,
    PipelineCaseOutput,
    z.infer<typeof verdictSchema>,
    QualityExpectation
  >({
    name: "citation-support",
    model,
    schema: verdictSchema,
    passes: (verdict) => verdict.passes,
    retries: 2,
    instructions: `You check the citations of an email reply. The citations are ids of playbooks. The reply passes only when every cited playbook supports at least one statement of the body, and every factual statement of the body is supported by at least one cited playbook. Greetings and sign-offs are not factual statements. ${ALLOWED_STATEMENTS}`,
    prompt: renderRun,
  });

  return {
    ...judge,
    evaluate: (args: Parameters<typeof judge.evaluate>[0]) =>
      isAnswer(args.output)
        ? judge.evaluate(args)
        : EvalOutcome.pass({ reason: NOT_APPLICABLE, passes: true }, { comment: NOT_APPLICABLE }),
  };
}

const claimsSchema = z.object({
  claims: z
    .array(
      z.object({
        claim: z.string().describe("One statement of the body, in its own words."),
        supported: z.boolean(),
        source: z
          .string()
          .describe(
            'The playbook id, "email" or "reply instructions" that supports it, or "none".',
          ),
      }),
    )
    .describe("Every statement of the body except greetings and sign-offs."),
  reason: z.string().describe("One or two sentences that name any unsupported statement."),
});

/**
 * Builds the faithfulness judge: it lists every statement of the body and checks each one against
 * the readable playbooks, the email and the reply instructions. The reply passes only when every
 * statement is supported.
 */
export function createFaithfulness(model: CompletionModel) {
  const judge = llmJudge<
    PipelineCaseInput,
    PipelineCaseOutput,
    z.infer<typeof claimsSchema>,
    QualityExpectation
  >({
    name: "faithfulness",
    model,
    schema: claimsSchema,
    passes: (verdict) => verdict.claims.every((claim) => claim.supported),
    retries: 2,
    instructions: `You check whether an email reply is faithful to its sources. List every statement of the body, then mark each one as supported or not. A statement is supported when a playbook, the email or the reply instructions of the user state it, in the same or other words with the same meaning, in any language, such as "available" for "possible" or a weekday that the playbook gives with the date. A statement is not supported when it adds a fact, a promise, an offer, an invitation to write again, a follow-up or an implication that no source states, such as that someone will attend, act or get back to the sender. Greetings and sign-offs such as "Hi Sam" and "Best regards" are not statements. ${ALLOWED_STATEMENTS}`,
    prompt: renderRun,
  });

  return {
    ...judge,
    evaluate: (args: Parameters<typeof judge.evaluate>[0]) =>
      isAnswer(args.output)
        ? judge.evaluate(args)
        : EvalOutcome.pass({ claims: [], reason: NOT_APPLICABLE }, { comment: NOT_APPLICABLE }),
  };
}
