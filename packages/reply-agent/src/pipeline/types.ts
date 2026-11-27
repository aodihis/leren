import { z } from "zod";
import type { Playbook } from "./playbooks";

/** The most revisions of a content draft that the content judge may ask for (decision 0066). */
export const MAX_REVISIONS = 2;

/** The most questions of one email that the answering agent is asked to search for. */
export const MAX_QUESTIONS = 5;

/**
 * The longest reply body, in characters, that the checks accept. It is about 450 words, which is
 * well above a normal email reply of 50 to 200 words.
 */
export const MAX_BODY_LENGTH = 3000;

/**
 * The most tokens that each model call of a stage may write (decision 0066). The limit of the
 * answering agent applies to each of its turns. A reasoning model counts its reasoning against the
 * limit as well, so every stage runs it at its lowest reasoning effort (decision 0067). An answer
 * that is cut off is not valid JSON, so the stage treats it as unreadable.
 */
export const MAX_OUTPUT_TOKENS = {
  triage: 600,
  answer: 1500,
  style: 1200,
  judge: 800,
} as const;

/** The longest reply instructions, in characters, that the pipeline passes to the drafter. */
export const MAX_INSTRUCTIONS_LENGTH = 2000;

/**
 * The lowest confidence in its own classification at which triage lets an email continue. An email
 * that triage is less sure about is escalated to the user and not answered. A triage answer
 * must carry a confidence, so a missing value is an invalid answer and the message is retried.
 */
export const MIN_TRIAGE_CONFIDENCE = 0.6;

/** What a received email is about, as triage decides it. */
export const CATEGORIES = [
  "project_question",
  "task_assignment",
  "informational",
  "urgent",
  "other",
] as const;

export type Category = (typeof CATEGORIES)[number];

/** How the pipeline ended for one message. */
export const OUTCOMES = ["answer", "escalate", "ignore"] as const;

export type Outcome = (typeof OUTCOMES)[number];

/** One received email, as the pipeline reads it. Every field is untrusted. */
export const emailSchema = z.object({
  from: z.string(),
  subject: z.string(),
  body: z.string(),
});

export type Email = z.infer<typeof emailSchema>;

/** What the pipeline receives for one message. */
export const pipelineInputSchema = z.object({
  messageId: z.string().min(1),
  email: emailSchema,
  checkMention: z.boolean().default(false),
  replyInstructions: z.string().optional(),
});

export type PipelineInput = z.input<typeof pipelineInputSchema>;

/** What the triage model answers. */
export const triageSchema = z.object({
  category: z.enum(CATEGORIES),
  questions: z.array(z.string().min(1)),
  injectionSuspected: z.boolean(),
  addressesUser: z.boolean(),
  confidence: z.number().min(0).max(1),
});

export type Triage = z.infer<typeof triageSchema>;

/**
 * What the answering agent answers. With `escalate`, `reason` says why and the other fields are
 * ignored. With `answer`, `body` is the content of the reply and `citations` lists the playbooks
 * it uses.
 */
export const answerSchema = z.object({
  outcome: z.enum(["answer", "escalate"]),
  reason: z.string().default(""),
  body: z.string().default(""),
  citations: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).optional(),
});

export type Answer = z.infer<typeof answerSchema>;

/** A reply that the pipeline checks: its body and the ids of the playbooks it cites. */
export type Draft = Pick<Answer, "body" | "citations" | "confidence">;

/** What the style model answers: the content draft rewritten with the reply instructions. */
export const styleSchema = z.object({ body: z.string() });

/** The criteria that the content judge scores, each as a pass or a fail. */
export const CONTENT_CRITERIA = [
  "groundedness",
  "coverage",
  "ruleCompliance",
  "injectionSafety",
] as const;

/** What the content judge answers. */
export const contentVerdictSchema = z.object({
  groundedness: z.boolean(),
  coverage: z.boolean(),
  ruleCompliance: z.boolean(),
  injectionSafety: z.boolean(),
  feedback: z.string(),
});

export type ContentVerdict = z.infer<typeof contentVerdictSchema>;

/** The criteria that the style judge scores, each as a pass or a fail. */
export const STYLE_CRITERIA = [
  "faithfulness",
  "instructionCompliance",
  "ruleCompliance",
  "injectionSafety",
] as const;

/** What the style judge answers. */
export const styleVerdictSchema = z.object({
  faithfulness: z.boolean(),
  instructionCompliance: z.boolean(),
  ruleCompliance: z.boolean(),
  injectionSafety: z.boolean(),
  feedback: z.string(),
});

export type StyleVerdict = z.infer<typeof styleVerdictSchema>;

export type Verdict = ContentVerdict | StyleVerdict;

/**
 * The result of checking one draft. `stage` names the draft that was checked, the content draft of
 * the answering agent or the styled draft, and so the judge whose verdict it holds. It passes only
 * when no check and no criterion fails.
 */
export type Evaluation =
  | {
      readonly stage: "content";
      readonly pass: boolean;
      readonly issues: readonly string[];
      readonly verdict?: ContentVerdict | undefined;
    }
  | {
      readonly stage: "style";
      readonly pass: boolean;
      readonly issues: readonly string[];
      readonly verdict?: StyleVerdict | undefined;
    };

/** What the pipeline returns for one message. */
export interface ReplyResult {
  readonly outcome: Outcome;
  readonly body?: string | undefined;
  readonly citations: readonly string[];
  readonly reasons: readonly string[];
  readonly triage?: Triage | undefined;
  readonly playbooks: readonly Playbook[];
  readonly evaluations: readonly Evaluation[];
  readonly revisions: number;
}
