import { MaxTurnsError } from "@anvia/core";
import type { CompletionModel } from "@anvia/core";
import type { McpOptions } from "@leren/agents";
import type { Observer } from "@leren/observability";
import { generateReply } from "../agent";
import type { ReplyRun } from "../agent";
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

/** Everything the stages need from the outside. */
export interface ReplyPipelineDeps {
  readonly models: {
    readonly triage: CompletionModel;
    readonly draft: CompletionModel;
    readonly judge: CompletionModel;
  };
  /** The fixed system prompt of the Reply Agent. */
  readonly rules: string;
  /** Searches the user's knowledge for an email. */
  readonly retrieve: (query: string, abortSignal?: AbortSignal) => Promise<Retrieval>;
  readonly observer: Observer;
  /** The ids of the only playbooks that may be used. */
  readonly allowedPlaybookIds?: ReadonlySet<string> | undefined;
  /** The MCP connection for read-only lookups. */
  readonly mcp?: McpOptions | undefined;
  readonly abortSignal?: AbortSignal | undefined;
}

/** Asks a completion stage and reads a schema answer. */
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

/** Decides whether to answer or escalate. */
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

/** Asks the judge whether a draft is grounded. */
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

/** What the draft and evaluate loop needs. */
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

/** What the draft and evaluate loop returns. */
export interface DraftOutcome {
  readonly draft?: Draft | undefined;
  /** The context playbooks and those the agent found. */
  readonly playbooks: readonly Playbook[];
  readonly evaluations: readonly Evaluation[];
  readonly revisions: number;
  readonly failure: readonly string[];
}

/** The prompt text shown for an unreadable draft. */
const UNREADABLE_DRAFT = "(the previous output could not be read)";

/** The evaluation record when the turns run out. */
const TURN_LIMIT_REACHED = "The drafting agent reached its turn limit without an answer.";

/** The prompt feedback after the turns run out. */
const TURN_LIMIT_FEEDBACK =
  "You used all your turns without an answer. Do not search again. Answer from the playbooks you have, and say that the sender will get an answer later for any question they do not cover.";

/** The problems that make a verdict fail. */
function describeVerdict(failed: readonly string[], feedback: string): string[] {
  const lines = failed.map((criterion) => `The draft fails the criterion ${criterion}.`);

  return feedback.trim() ? [...lines, feedback.trim()] : lines;
}

/** The evaluator and optimizer loop. */
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
    let run: ReplyRun;

    try {
      run = await generateReply({
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
    } catch (error) {
      if (!(error instanceof MaxTurnsError)) {
        throw error;
      }

      evaluations.push({ pass: false, issues: [TURN_LIMIT_REACHED] });
      feedback = [TURN_LIMIT_FEEDBACK];
      previousBody = UNREADABLE_DRAFT;
      continue;
    }

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
