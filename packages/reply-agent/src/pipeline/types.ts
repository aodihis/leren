import { z } from "zod";
import type { Playbook } from "../agents/retriever/types";

/** The most revisions of a draft that the evaluator may ask for (decision 0042). */
export const MAX_REVISIONS = 2;

/** The most questions of one email that are searched for separately. */
export const MAX_QUESTIONS = 5;

/** The longest reply body, in characters, that the evaluator accepts. */
export const MAX_BODY_LENGTH = 5000;

/** The longest reply instructions, in characters, that the pipeline passes to the drafter. */
export const MAX_INSTRUCTIONS_LENGTH = 2000;

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
});

export type Triage = z.infer<typeof triageSchema>;

/** What the routing model answers. */
export const routeSchema = z.object({
  outcome: z.enum(["answer", "escalate"]),
  reason: z.string(),
});

export type Route = z.infer<typeof routeSchema>;

/** What the drafting agent answers. */
export const draftSchema = z.object({
  body: z.string(),
  citations: z.array(z.string()),
  confidence: z.number().min(0).max(1).optional(),
});

export type Draft = z.infer<typeof draftSchema>;

/** The criteria that the judge scores, each as a pass or a fail. */
export const CRITERIA = [
  "groundedness",
  "coverage",
  "ruleCompliance",
  "instructionCompliance",
  "injectionSafety",
] as const;

export type Criterion = (typeof CRITERIA)[number];

/** What the judge model answers. */
export const verdictSchema = z.object({
  groundedness: z.boolean(),
  coverage: z.boolean(),
  ruleCompliance: z.boolean(),
  instructionCompliance: z.boolean(),
  injectionSafety: z.boolean(),
  feedback: z.string(),
});

export type Verdict = z.infer<typeof verdictSchema>;

/** The evaluator's result for one draft. It passes only when no check and no criterion fails. */
export interface Evaluation {
  readonly pass: boolean;
  readonly issues: readonly string[];
  readonly verdict?: Verdict | undefined;
}

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
