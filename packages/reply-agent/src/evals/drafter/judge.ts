import type { CompletionModel } from "@anvia/core";
import { EvalOutcome, llmJudge } from "@anvia/core/evals";
import { NOT_APPLICABLE } from "@leren/evals";
import { z } from "zod";
import { keepAllowed } from "../../pipeline/playbooks";
import { renderPlaybooks } from "../../pipeline/prompts";
import type { Outcome } from "../../pipeline/types";
import type { DrafterInput, DrafterOutput } from "./target";

/**
 * What a judged case expects. `outcome` is the outcome, or the outcomes, that are right for the
 * case, and `criteria` states the right behaviour in words that the judge grades against.
 */
export type JudgeExpectation = {
  outcome: Exclude<Outcome, "ignore"> | readonly Exclude<Outcome, "ignore">[];
  criteria: string;
};

type Args = {
  case: { input: DrafterInput; expected?: JudgeExpectation | undefined };
  output: DrafterOutput;
};

const verdictSchema = z.object({
  reason: z.string().describe("One or two sentences that justify the verdict."),
  passes: z.boolean().describe("True only when the answer meets every part of the criteria."),
});

/** The playbooks that the drafter could read in a case: those that the gate allowed. */
function readablePlaybooks(input: DrafterInput) {
  return keepAllowed(
    input.playbooks,
    input.allowedPlaybookIds && new Set(input.allowedPlaybookIds),
  );
}

/**
 * What the drafter may write besides the facts of the playbooks. Every judge receives it, so they
 * all agree that only the body reaches the sender and on which follow-ups are supported.
 */
const ALLOWED_STATEMENTS =
  "Only the body is sent to the sender. The reason is an internal note for the user and is not part of the reply. Besides the facts of the playbooks, the body may greet the sender by name and restate what the sender wrote in the email, and neither is an unsupported fact. A follow-up sentence, such as that the sender will get an answer later, that someone will get back to them, or an invitation such as 'Let me know if anything else is needed', is supported only when a playbook or the reply instructions of the user give it.";

/** Renders the case and the drafter's answer for a judge. The playbooks are the only source of truth. */
function renderRun({ case: testCase, output }: Args): string {
  const { input } = testCase;
  const answer = output.answer;

  return [
    `Email from ${input.email.from}, subject "${input.email.subject}":\n${input.email.body}`,
    `Questions in the email:\n${input.questions.map((question) => `- ${question}`).join("\n") || "(none)"}`,
    `Playbooks that the drafter could read, the only source of truth:\n${renderPlaybooks(readablePlaybooks(input))}`,
    `Reply instructions of the user: ${input.replyInstructions ?? "none"}`,
    `Tools that the drafter called: ${JSON.stringify(output.toolCalls)}`,
    answer
      ? `Drafter's answer:\n${JSON.stringify({ outcome: answer.outcome, reason: answer.reason, body: answer.body, citations: answer.citations }, null, 2)}`
      : `Drafter's answer is unreadable:\n${output.raw}`,
  ].join("\n\n");
}

const isAnswer = (output: DrafterOutput) => output.answer?.outcome === "answer";

/**
 * Builds the judge that grades the drafter's answer against the criteria of the case. The drafter
 * answers an email from playbooks or escalates it to the user, and an escalation is graded by its
 * reason. The judge never learns whether a case is meant to be good or bad.
 */
export function createBehaviourJudge(model: CompletionModel) {
  return llmJudge<DrafterInput, DrafterOutput, z.infer<typeof verdictSchema>, JudgeExpectation>({
    name: "behaviour",
    model,
    schema: verdictSchema,
    passes: (verdict) => verdict.passes,
    retries: 2,
    instructions: `You grade a drafter that writes the content of an email reply from the user's playbooks, or escalates the email to the user with "outcome": "escalate" when it cannot answer from them. Judge only against the criteria and the playbooks, not against your own opinion of a good reply. Do not require details that the criteria do not ask for, such as a weekday when the date is given. Tone and style do not matter. Be strict: if one part of the criteria is not met, the answer does not pass. A fact in the body that no playbook states is a failure, even when it is plausible. ${ALLOWED_STATEMENTS}`,
    prompt: (args) => `${renderRun(args)}\n\nCriteria:\n${args.case.expected?.criteria ?? ""}`,
  });
}

/**
 * Builds the judge that checks the citations of an answer: every cited playbook supports part of
 * the body, and every fact in the body comes from a cited playbook. It does not apply to an
 * escalation, which has no body.
 */
export function createCitationJudge(model: CompletionModel) {
  const judge = llmJudge<
    DrafterInput,
    DrafterOutput,
    z.infer<typeof verdictSchema>,
    JudgeExpectation
  >({
    name: "citation-support",
    model,
    schema: verdictSchema,
    passes: (verdict) => verdict.passes,
    retries: 2,
    instructions: `You check the citations of an email reply. The citations are ids of playbooks. The answer passes only when every cited playbook supports at least one statement of the body, and every factual statement of the body is supported by at least one cited playbook. Greetings and sign-offs are not factual statements. ${ALLOWED_STATEMENTS}`,
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
 * the readable playbooks, the email and the reply instructions. The answer passes only when every
 * statement is supported. It does not apply to an escalation, which has no body.
 */
export function createFaithfulness(model: CompletionModel) {
  const judge = llmJudge<
    DrafterInput,
    DrafterOutput,
    z.infer<typeof claimsSchema>,
    JudgeExpectation
  >({
    name: "faithfulness",
    model,
    schema: claimsSchema,
    passes: (verdict) => verdict.claims.every((claim) => claim.supported),
    retries: 2,
    instructions: `You check whether an email reply is faithful to its sources. List every statement of the body, then mark each one as supported or not. A statement is supported when a playbook, the email or the reply instructions of the user state it, in the same or other words with the same meaning, such as "available" for "possible" or a weekday that the playbook gives with the date. A statement is not supported when it adds a fact, a promise, an offer, an invitation to write again, a follow-up or an implication that no source states, such as that someone will attend, act or get back to the sender. Greetings and sign-offs such as "Hi Sam" and "Best regards" are not statements. ${ALLOWED_STATEMENTS}`,
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
