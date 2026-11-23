import type { CompletionModel } from "@anvia/core";
import type { McpOptions } from "@leren/agents";
import type { Observer } from "@leren/observability";
import { generateReply } from "../agent";
import { checkDraft } from "./guardrails";
import { InvalidModelOutputError, generateJson, parseJsonOutput } from "./llm";
import {
  JUDGE_INSTRUCTIONS,
  ROUTE_INSTRUCTIONS,
  TRIAGE_INSTRUCTIONS,
  buildDraftInstructions,
  buildDraftPrompt,
  buildJudgePrompt,
  buildRoutePrompt,
} from "./prompts";
import { collectPlaybooks, keepAllowed, mergePlaybooks } from "./retrieve";
import {
  CRITERIA,
  MAX_REVISIONS,
  draftSchema,
  routeSchema,
  triageSchema,
  verdictSchema,
} from "./types";
import type {
  Category,
  Draft,
  Evaluation,
  Playbook,
  Retrieval,
  Route,
  Triage,
  Verdict,
} from "./types";

/** Everything the stages need from the outside: models, retrieval and the system prompt. */
export interface ReplyPipelineDeps {
  readonly models: {
    readonly triage: CompletionModel;
    readonly draft: CompletionModel;
    readonly judge: CompletionModel;
  };
  /** The fixed system prompt of the Reply Agent. */
  readonly rules: string;
  /** Searches the knowledge of the user for an email, through the MCP server. */
  readonly retrieve: (query: string, abortSignal?: AbortSignal) => Promise<Retrieval>;
  readonly observer: Observer;
  /**
   * The ids of the only playbooks that may be used. Playbooks that retrieval or the drafting agent
   * return outside this set are dropped. Without it, every playbook that is found may be used.
   */
  readonly allowedPlaybookIds?: ReadonlySet<string> | undefined;
  /** The MCP connection that the drafting agent may use for read-only lookups. */
  readonly mcp?: McpOptions | undefined;
  readonly abortSignal?: AbortSignal | undefined;
}

/** Asks one of the completion stages its question and reads the answer as `schema`. */
function ask<Value>(
  deps: ReplyPipelineDeps,
  stage: Pick<Parameters<typeof generateJson<Value>>[0], "model" | "instructions" | "schema">,
  prompt: string,
): Promise<Value> {
  return generateJson({ ...stage, prompt, abortSignal: deps.abortSignal });
}

/** Classifies an email. */
export function triage(deps: ReplyPipelineDeps, email: string): Promise<Triage> {
  return ask(
    deps,
    { model: deps.models.triage, instructions: TRIAGE_INSTRUCTIONS, schema: triageSchema },
    email,
  );
}

/** Decides whether to answer, delegate or escalate, from the retrieved playbooks. */
export function route(
  deps: ReplyPipelineDeps,
  options: {
    readonly email: string;
    readonly triage: Triage;
    readonly playbooks: readonly Playbook[];
  },
): Promise<Route> {
  return ask(
    deps,
    { model: deps.models.triage, instructions: ROUTE_INSTRUCTIONS, schema: routeSchema },
    buildRoutePrompt(options),
  );
}

/** The longest contact, in characters, that a delegated reply may name. */
export const MAX_CONTACT_LENGTH = 200;

/** Collects every string in a value of unknown shape, so a contact may be stored in any layout. */
function stringsOf(value: unknown, found: string[] = []): string[] {
  if (typeof value === "string") {
    found.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) {
      stringsOf(item, found);
    }
  } else if (typeof value === "object" && value !== null) {
    for (const item of Object.values(value)) {
      stringsOf(item, found);
    }
  }

  return found;
}

/**
 * Finds the contact of a playbook that the routing model named. A contact matches when the model's
 * text equals one stored contact, or the address inside its angle brackets, ignoring case. Returns
 * the stored text, so a delegated reply never carries text that the model wrote, or `undefined`
 * when no stored contact matches.
 */
export function findContact(playbooks: readonly Playbook[], contact: string): string | undefined {
  const needle = contact.trim().toLowerCase();

  if (needle.length === 0) {
    return undefined;
  }

  for (const playbook of playbooks) {
    for (const stored of stringsOf(playbook.contacts)) {
      const address = /<([^<>]+)>/.exec(stored)?.[1];

      if (
        stored.length <= MAX_CONTACT_LENGTH &&
        (stored.trim().toLowerCase() === needle || address?.trim().toLowerCase() === needle)
      ) {
        return stored.trim();
      }
    }
  }

  return undefined;
}

/**
 * Asks the judge model whether a draft reply is grounded in the playbooks, follows their rules and
 * the reply instructions, and does not obey the email. Throws when the judge does not answer in the
 * expected format.
 */
export function judge(
  deps: ReplyPipelineDeps,
  options: {
    readonly email: string;
    readonly questions?: readonly string[] | undefined;
    readonly playbooks: readonly Playbook[];
    readonly replyInstructions?: string | undefined;
    readonly body: string;
  },
): Promise<Verdict> {
  return ask(
    deps,
    { model: deps.models.judge, instructions: JUDGE_INSTRUCTIONS, schema: verdictSchema },
    buildJudgePrompt(options),
  );
}

/** What the draft and evaluate loop needs for one email. */
export interface DraftContext {
  readonly email: string;
  readonly category: Category;
  /** The questions of the email, as triage listed them. */
  readonly questions: readonly string[];
  /** The questions for which no playbook was found. */
  readonly unmatched: readonly string[];
  readonly playbooks: readonly Playbook[];
  readonly replyInstructions: string | undefined;
}

/** What the draft and evaluate loop returns. `draft` is set only when the evaluator passed it. */
export interface DraftOutcome {
  readonly draft?: Draft | undefined;
  /** The playbooks of the context and every playbook that the agent found with its own searches. */
  readonly playbooks: readonly Playbook[];
  readonly evaluations: readonly Evaluation[];
  readonly revisions: number;
  readonly failure: readonly string[];
}

/**
 * What the next prompt shows in place of a draft that could not be read. The unreadable text is
 * never repeated, so that a model cannot keep repeating content that it should not have written.
 */
const UNREADABLE_DRAFT = "(the previous output could not be read)";

/** The problems that make a verdict fail, in words the drafter can act on. */
function describeVerdict(failed: readonly string[], feedback: string): string[] {
  const lines = failed.map((criterion) => `The draft fails the criterion ${criterion}.`);

  return feedback.trim() ? [...lines, feedback.trim()] : lines;
}

/**
 * The evaluator and optimizer loop (decision 0042). It asks the drafting agent for a reply,
 * evaluates it with the checks that need no model and then with the judge, and sends the problems
 * back to the agent for a revision. It stops at the first draft that passes, or after
 * `MAX_REVISIONS` revisions, and then reports the problems of the last draft. An answer of the judge
 * that cannot be read ends the loop with a failure, so an unchecked draft is never accepted. A
 * failure of the judge call itself is thrown, so that the queue retries the message.
 */
export async function draftAndEvaluate(
  deps: ReplyPipelineDeps,
  context: DraftContext,
): Promise<DraftOutcome> {
  const instructions = buildDraftInstructions(deps.rules, context.replyInstructions);
  let known: readonly Playbook[] = context.playbooks;
  const evaluations: Evaluation[] = [];
  let feedback: string[] = [];
  let previousBody: string | undefined;

  for (let attempt = 0; attempt <= MAX_REVISIONS; attempt += 1) {
    const run = await generateReply({
      instructions,
      prompt: buildDraftPrompt({
        email: context.email,
        category: context.category,
        questions: context.questions,
        unmatched: context.unmatched,
        playbooks: known,
        feedback,
        previousBody,
      }),
      model: deps.models.draft,
      observer: deps.observer,
      mcp: deps.mcp,
      abortSignal: deps.abortSignal,
    });

    known = mergePlaybooks(
      known,
      keepAllowed(collectPlaybooks(run.messages), deps.allowedPlaybookIds),
    );

    const text = run.output;
    const parsed = parseJsonOutput(text, draftSchema);

    if (!parsed.ok) {
      evaluations.push({ pass: false, issues: [parsed.error] });
      feedback = [parsed.error];
      previousBody = UNREADABLE_DRAFT;
      continue;
    }

    const draft = parsed.value;
    const issues = checkDraft(draft, new Set(known.map((playbook) => playbook.id)));

    if (issues.length > 0) {
      evaluations.push({ pass: false, issues });
      feedback = issues;
      previousBody = draft.body;
      continue;
    }

    let verdict;

    try {
      verdict = await judge(deps, {
        email: context.email,
        questions: context.questions,
        playbooks: known,
        replyInstructions: context.replyInstructions,
        body: draft.body,
      });
    } catch (error) {
      if (!(error instanceof InvalidModelOutputError)) {
        throw error;
      }

      const reason = `The evaluator failed: ${error.message}`;

      evaluations.push({ pass: false, issues: [reason] });

      return { playbooks: known, evaluations, revisions: attempt, failure: [reason] };
    }

    const failed = CRITERIA.filter((criterion) => !verdict[criterion]);
    const pass = failed.length === 0;
    const problems = describeVerdict(failed, verdict.feedback);

    evaluations.push({ pass, issues: problems, verdict });

    if (pass) {
      return { draft, playbooks: known, evaluations, revisions: attempt, failure: [] };
    }

    feedback = problems;
    previousBody = draft.body;
  }

  const last = evaluations.at(-1);

  return {
    playbooks: known,
    evaluations,
    revisions: MAX_REVISIONS,
    failure: last?.issues ?? ["The draft did not pass the evaluator."],
  };
}
