import { MaxTurnsError } from "@anvia/core";
import type { CompletionModel, Message } from "@anvia/core";
import type { McpOptions } from "@leren/agents";
import type { Observer } from "@leren/observability";
import { generateReply } from "../agents/drafter/agent";
import type { ReplyRun, RunAgentOptions } from "../agents/drafter/agent";
import { checkDraft, checkOutput } from "./guardrails";
import {
  InvalidModelOutputError,
  generateJson,
  lowestReasoningEffort,
  parseJsonOutput,
} from "./llm";
import {
  buildAnswerInstructions,
  buildAnswerPrompt,
  buildContentJudgePrompt,
  buildStyleInstructions,
  buildStyleJudgePrompt,
  buildStylePrompt,
  defaultInstructions,
} from "./prompts";
import type { ReplyPrompts } from "./prompts";
import { collectPlaybooks, keepAllowed, mergePlaybooks, playbookSearchFailed } from "./playbooks";
import type { Playbook } from "./playbooks";
import {
  CONTENT_CRITERIA,
  MAX_OUTPUT_TOKENS,
  MAX_REVISIONS,
  STYLE_CRITERIA,
  answerSchema,
  contentVerdictSchema,
  styleSchema,
  styleVerdictSchema,
  triageSchema,
} from "./types";
import type { Category, ContentVerdict, Draft, Evaluation, StyleVerdict, Triage } from "./types";

/** Everything the stages need from the outside: models, prompts, the MCP connection and the observer. */
export interface ReplyPipelineDeps {
  readonly models: {
    readonly triage: CompletionModel;
    /** The model of the answering agent and of the style stage. */
    readonly draft: CompletionModel;
    readonly judge: CompletionModel;
  };
  /** The fixed prompts of the stages and of the answering agent. */
  readonly prompts: ReplyPrompts;
  readonly observer: Observer;
  /**
   * The ids of the only playbooks that may be used. Playbooks that the answering agent finds outside
   * this set are dropped. Without it, every playbook that is found may be used.
   */
  readonly allowedPlaybookIds?: ReadonlySet<string> | undefined;
  /** The MCP connection through which the answering agent searches the playbooks, read-only. */
  readonly mcp?: McpOptions | undefined;
  /**
   * Tools that the answering agent gets in addition to its own and to those of `mcp`. The evals use
   * them to give the agent fake playbook tools with the names and results of the MCP tools.
   */
  readonly tools?: RunAgentOptions["tools"];
  readonly abortSignal?: AbortSignal | undefined;
}

/**
 * Asks one of the completion stages its question and reads the answer as `schema`. A reasoning
 * model runs at its lowest reasoning effort.
 */
function ask<Value>(
  deps: ReplyPipelineDeps,
  stage: Pick<
    Parameters<typeof generateJson<Value>>[0],
    "model" | "instructions" | "schema" | "maxTokens"
  >,
  prompt: string,
): Promise<Value> {
  return generateJson({
    ...stage,
    prompt,
    controls: lowestReasoningEffort(stage.model),
    abortSignal: deps.abortSignal,
  });
}

/** Classifies an email. */
export function triage(deps: ReplyPipelineDeps, email: string): Promise<Triage> {
  return ask(
    deps,
    {
      model: deps.models.triage,
      instructions: deps.prompts.triage,
      schema: triageSchema,
      maxTokens: MAX_OUTPUT_TOKENS.triage,
    },
    email,
  );
}

/**
 * Asks the content judge whether a content draft is grounded in the playbooks, covers every
 * question, follows what the instructions forbid, and does not obey the email. Throws when the
 * judge does not answer in the expected format.
 */
function judgeContent(
  deps: ReplyPipelineDeps,
  options: Parameters<typeof buildContentJudgePrompt>[0],
): Promise<ContentVerdict> {
  return ask(
    deps,
    {
      model: deps.models.judge,
      instructions: deps.prompts.judge,
      schema: contentVerdictSchema,
      maxTokens: MAX_OUTPUT_TOKENS.judge,
    },
    buildContentJudgePrompt(options),
  );
}

/**
 * Asks the style judge whether a styled reply keeps the facts of the content draft and follows the
 * reply instructions. Throws when the judge does not answer in the expected format.
 */
function judgeStyle(
  deps: ReplyPipelineDeps,
  options: Parameters<typeof buildStyleJudgePrompt>[0],
): Promise<StyleVerdict> {
  return ask(
    deps,
    {
      model: deps.models.judge,
      instructions: deps.prompts.styleJudge,
      schema: styleVerdictSchema,
      maxTokens: MAX_OUTPUT_TOKENS.judge,
    },
    buildStyleJudgePrompt(options),
  );
}

/** What the answer loop needs for one email. */
export interface AnswerContext {
  readonly email: string;
  readonly category: Category;
  /** The questions of the email, as triage listed them. */
  readonly questions: readonly string[];
  readonly replyInstructions: string | undefined;
}

/**
 * What the answer loop returns. `draft` is set only when the agent answered and the content judge
 * passed the draft. Otherwise `failure` holds the reasons for the escalation.
 */
export interface AnswerOutcome {
  readonly draft?: Draft | undefined;
  /** Every allowed playbook that the agent found with its searches. */
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

/** What the evaluation records when the answering agent uses all its turns without an answer. */
const TURN_LIMIT_REACHED = "The answering agent reached its turn limit without an answer.";

/** What the next prompt tells the agent after it used all its turns. */
const TURN_LIMIT_FEEDBACK =
  "You used all your turns without an answer. Do not search again. Answer from the playbooks you have, and say that the sender will get an answer later for any question they do not cover.";

/** The reason of an answer for which the agent found no playbook. */
const NO_PLAYBOOK = "No playbook matches the email reliably.";

/** The problems that make a verdict fail, in words that the next attempt can act on. */
function describeVerdict(failed: readonly string[], feedback: string): string[] {
  const lines = failed.map((criterion) => `The draft fails the criterion ${criterion}.`);

  return feedback.trim() ? [...lines, feedback.trim()] : lines;
}

/**
 * The answer loop (decision 0066). The answering agent searches the playbooks for the questions of
 * the email, decides whether to answer or escalate, and writes the content of the reply. A content
 * draft goes through the checks that need no model and then the content judge, and a failure goes
 * back to the agent as feedback, at most `MAX_REVISIONS` times.
 *
 * Abstention is decided in code: an answer for which the agent found no allowed playbook ends the
 * loop with a failure, so a reply is never built on nothing. A judge answer that cannot be read
 * also ends the loop with a failure, so an unchecked draft is never accepted. A failure of a model
 * call or of a playbook search is thrown, so that the queue retries the message.
 */
export async function answerAndEvaluate(
  deps: ReplyPipelineDeps,
  context: AnswerContext,
): Promise<AnswerOutcome> {
  const instructions = buildAnswerInstructions(deps.prompts.rules, context.replyInstructions);
  let known: readonly Playbook[] = [];
  const evaluations: Evaluation[] = [];
  let feedback: string[] = [];
  let previousBody: string | undefined;

  /**
   * Adds the allowed playbooks that the searches of a run returned, also of a run that used all its
   * turns, so that a later attempt is shown them and does not have to search again. Throws when a
   * playbook search failed, so that a server or authorization problem is retried by the queue and
   * is not recorded as an escalation.
   */
  const remember = (messages: readonly Message[]) => {
    if (playbookSearchFailed(messages)) {
      throw new Error("A playbook search of the answering agent failed.");
    }

    known = mergePlaybooks(known, keepAllowed(collectPlaybooks(messages), deps.allowedPlaybookIds));
  };

  const fail = (revisions: number, failure: readonly string[]): AnswerOutcome => ({
    playbooks: known,
    evaluations,
    revisions,
    failure,
  });

  for (let attempt = 0; attempt <= MAX_REVISIONS; attempt += 1) {
    let run: ReplyRun;

    try {
      run = await generateReply({
        instructions,
        prompt: buildAnswerPrompt({
          email: context.email,
          category: context.category,
          questions: context.questions,
          playbooks: known,
          feedback,
          previousBody,
        }),
        model: deps.models.draft,
        observer: deps.observer,
        mcp: deps.mcp,
        tools: deps.tools,
        maxTokens: MAX_OUTPUT_TOKENS.answer,
        controls: lowestReasoningEffort(deps.models.draft),
        abortSignal: deps.abortSignal,
      });
    } catch (error) {
      if (!(error instanceof MaxTurnsError)) {
        throw error;
      }

      remember(error.chatHistory);
      evaluations.push({ stage: "content", pass: false, issues: [TURN_LIMIT_REACHED] });
      feedback = [TURN_LIMIT_FEEDBACK];
      previousBody = UNREADABLE_DRAFT;
      continue;
    }

    remember(run.messages);

    const parsed = parseJsonOutput(run.output, answerSchema);

    if (!parsed.ok) {
      evaluations.push({ stage: "content", pass: false, issues: [parsed.error] });
      feedback = [parsed.error];
      previousBody = UNREADABLE_DRAFT;
      continue;
    }

    const answer = parsed.value;

    if (answer.outcome === "escalate") {
      return fail(attempt, [answer.reason.trim() || "The answering agent escalated the email."]);
    }

    if (known.length === 0) {
      return fail(attempt, [NO_PLAYBOOK]);
    }

    const draft: Draft = {
      body: answer.body,
      citations: answer.citations,
      confidence: answer.confidence,
    };

    const issues = checkDraft(draft, new Set(known.map((playbook) => playbook.id)));

    if (issues.length > 0) {
      evaluations.push({ stage: "content", pass: false, issues });
      feedback = issues;
      previousBody = draft.body;
      continue;
    }

    let verdict;

    try {
      verdict = await judgeContent(deps, {
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

      evaluations.push({ stage: "content", pass: false, issues: [reason] });

      return fail(attempt, [reason]);
    }

    const failed = CONTENT_CRITERIA.filter((criterion) => !verdict[criterion]);
    const pass = failed.length === 0;
    const problems = describeVerdict(failed, verdict.feedback);

    evaluations.push({ stage: "content", pass, issues: problems, verdict });

    if (pass) {
      return { draft, playbooks: known, evaluations, revisions: attempt, failure: [] };
    }

    feedback = problems;
    previousBody = draft.body;
  }

  return fail(
    MAX_REVISIONS,
    evaluations.at(-1)?.issues ?? ["The draft did not pass the evaluator."],
  );
}

/**
 * Whether a reply has instructions to style it with: default reply instructions, or an instruction
 * on a playbook that it cites. Without either, the style stage has nothing to apply and is skipped.
 */
export function needsStyle(
  replyInstructions: string | undefined,
  cited: readonly Playbook[],
): boolean {
  return (
    defaultInstructions(replyInstructions) !== undefined ||
    cited.some((playbook) => Boolean(playbook.instruction?.trim()))
  );
}

/** What the style stage needs: a content draft that the content judge passed. */
export interface StyleContext {
  readonly email: string;
  readonly draft: Draft;
  /** The playbooks that the draft cites. */
  readonly playbooks: readonly Playbook[];
  readonly replyInstructions: string | undefined;
}

/**
 * What the style stage returns: the body to use and the evaluation of the styled reply. `fallback`
 * is set when the styled reply was not used, and says why.
 */
export interface StyleOutcome {
  readonly body: string;
  readonly evaluation: Evaluation;
  readonly fallback?: string | undefined;
}

/**
 * The style stage (decision 0066). The style model rewrites the content draft with the persona,
 * the tone and the prohibitions of the reply instructions and of the cited playbooks. The styled
 * reply is checked once, by the checks that need no model and then by the style judge, and is never
 * revised. A styled reply that fails, or an answer that cannot be read, is discarded and the
 * content draft is used, because the content judge has already passed it. A failure of a model
 * call itself is thrown, so that the queue retries the message.
 */
export async function styleAndEvaluate(
  deps: ReplyPipelineDeps,
  context: StyleContext,
): Promise<StyleOutcome> {
  const fallBack = (issues: readonly string[], verdict?: StyleVerdict): StyleOutcome => ({
    body: context.draft.body,
    evaluation: { stage: "style", pass: false, issues, verdict },
    fallback: `The styled reply was not used: ${issues.join(" ")}`,
  });

  let styled: string;

  try {
    const answer = await ask(
      deps,
      {
        model: deps.models.draft,
        instructions: buildStyleInstructions(deps.prompts.style),
        schema: styleSchema,
        maxTokens: MAX_OUTPUT_TOKENS.style,
      },
      buildStylePrompt({
        body: context.draft.body,
        playbooks: context.playbooks,
        replyInstructions: context.replyInstructions,
      }),
    );

    styled = answer.body;
  } catch (error) {
    if (!(error instanceof InvalidModelOutputError)) {
      throw error;
    }

    return fallBack([error.message]);
  }

  const cited = new Set(context.draft.citations);
  const candidate = { body: styled, citations: context.draft.citations };
  const issues = [...checkDraft(candidate, cited), ...checkOutput(candidate, cited).reasons];

  if (issues.length > 0) {
    return fallBack(issues);
  }

  let verdict;

  try {
    verdict = await judgeStyle(deps, {
      email: context.email,
      playbooks: context.playbooks,
      replyInstructions: context.replyInstructions,
      draftBody: context.draft.body,
      styledBody: styled,
    });
  } catch (error) {
    if (!(error instanceof InvalidModelOutputError)) {
      throw error;
    }

    return fallBack([`The evaluator failed: ${error.message}`]);
  }

  const failed = STYLE_CRITERIA.filter((criterion) => !verdict[criterion]);

  if (failed.length > 0) {
    return fallBack(describeVerdict(failed, verdict.feedback), verdict);
  }

  return { body: styled, evaluation: { stage: "style", pass: true, issues: [], verdict } };
}
