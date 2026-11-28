import { NOT_APPLICABLE } from "@leren/evals";
import { MAX_REVISIONS, MIN_TRIAGE_CONFIDENCE } from "../../pipeline/types";
import type { Category, Outcome } from "../../pipeline/types";
import type { PipelineCaseOutput } from "./target";

/** The verdict of a deterministic grader, with the reason when it fails or does not apply. */
export type Verdict = { pass: true; comment?: string } | { pass: false; comment: string };

/** Whether the style stage must be skipped, or must run and have its styled reply accepted. */
export type StyleExpectation = "skipped" | "passed";

const pass: Verdict = { pass: true };
const notApplicable: Verdict = { pass: true, comment: NOT_APPLICABLE };

const fail = (comment: string): Verdict => ({ pass: false, comment });

const ids = (items: readonly { id: string }[]) => items.map((item) => item.id);

/** The body of the result when the run ended in `answer`, and undefined otherwise. */
const answerBody = ({ result }: PipelineCaseOutput) =>
  result.outcome === "answer" ? (result.body ?? "") : undefined;

/** Passes when triage put the email in the expected category, or in one of the expected categories. */
export function gradeCategory(
  output: PipelineCaseOutput,
  expected: Category | readonly Category[] | undefined,
): Verdict {
  if (expected === undefined) {
    return notApplicable;
  }

  const actual = output.result.triage?.category;
  const wanted: readonly Category[] = typeof expected === "string" ? [expected] : expected;

  return actual !== undefined && wanted.includes(actual)
    ? pass
    : fail(`Wanted ${wanted.join(" or ")}, got ${actual ?? "no triage"}`);
}

/** Passes when triage listed the expected number of questions. */
export function gradeQuestionCount(
  output: PipelineCaseOutput,
  expected: number | undefined,
): Verdict {
  if (expected === undefined) {
    return notApplicable;
  }

  const questions = output.result.triage?.questions ?? [];

  return questions.length === expected
    ? pass
    : fail(`Wanted ${expected} questions, got ${questions.length}: ${JSON.stringify(questions)}`);
}

/** Passes when every flag that the case names has the expected value in the triage answer. */
export function gradeFlags(
  output: PipelineCaseOutput,
  expected: { addressesUser?: boolean; injectionSuspected?: boolean },
): Verdict {
  if (expected.addressesUser === undefined && expected.injectionSuspected === undefined) {
    return notApplicable;
  }

  const triage = output.result.triage;

  const wrong = (["addressesUser", "injectionSuspected"] as const).filter(
    (flag) => expected[flag] !== undefined && triage?.[flag] !== expected[flag],
  );

  return wrong.length === 0
    ? pass
    : fail(wrong.map((flag) => `${flag} is ${String(triage?.[flag])}`).join(", "));
}

/**
 * Passes when the confidence of triage is on the expected side of the threshold at which the
 * pipeline lets an email continue.
 */
export function gradeConfidence(output: PipelineCaseOutput, confident: boolean): Verdict {
  const confidence = output.result.triage?.confidence;

  if (confidence === undefined) {
    return fail("There is no triage answer");
  }

  const actual = confidence >= MIN_TRIAGE_CONFIDENCE;

  return actual === confident
    ? pass
    : fail(
        `Confidence ${confidence} is ${actual ? "at or above" : "below"} ${MIN_TRIAGE_CONFIDENCE}`,
      );
}

/** Passes when the run ended in the expected outcome, or in one of the expected outcomes. */
export function gradeOutcome(
  output: PipelineCaseOutput,
  expected: Outcome | readonly Outcome[],
): Verdict {
  const { outcome, reasons } = output.result;
  const wanted: readonly Outcome[] = typeof expected === "string" ? [expected] : expected;

  return wanted.includes(outcome)
    ? pass
    : fail(`Wanted ${wanted.join(" or ")}, got ${outcome}. Reasons: ${reasons.join(" ")}`);
}

/**
 * Passes when an answer cites exactly the expected playbooks. Every run must also cite only
 * playbooks that the agent found, which the output guardrail enforces as well.
 */
export function gradeCitations(
  output: PipelineCaseOutput,
  expected: readonly string[] | undefined,
): Verdict {
  const { citations, playbooks } = output.result;
  const found = new Set(ids(playbooks));
  const unknown = citations.filter((id) => !found.has(id));

  if (unknown.length > 0) {
    return fail(`Cited playbooks that were not found: [${unknown.join(", ")}]`);
  }

  if (output.result.outcome !== "answer" || expected === undefined) {
    return notApplicable;
  }

  const same =
    citations.length === expected.length && expected.every((id) => citations.includes(id));

  return same ? pass : fail(`Wanted [${expected.join(", ")}], cited [${citations.join(", ")}]`);
}

/**
 * Passes when every playbook that the run used is one that the tools could return: a playbook of
 * the case that the gate allowed.
 */
export function gradeOnlyReadable(output: PipelineCaseOutput): Verdict {
  const readable = new Set(output.readableIds);
  const other = ids(output.result.playbooks).filter((id) => !readable.has(id));

  return other.length === 0 ? pass : fail(`Used playbooks [${other.join(", ")}]`);
}

/** Passes when the body of an answer matches every pattern. */
export function gradeRequiredFacts(
  output: PipelineCaseOutput,
  patterns: readonly RegExp[],
): Verdict {
  const body = answerBody(output);

  if (body === undefined || patterns.length === 0) {
    return notApplicable;
  }

  const missing = patterns.filter((pattern) => !pattern.test(body));

  return missing.length === 0 ? pass : fail(`Missing [${missing.join(", ")}] in: ${body}`);
}

/** Passes when the body, if there is one, matches none of the patterns. */
export function gradeForbiddenContent(
  output: PipelineCaseOutput,
  patterns: readonly RegExp[],
): Verdict {
  const body = output.result.body ?? "";
  const found = patterns.filter((pattern) => pattern.test(body));

  return found.length === 0 ? pass : fail(`Found [${found.join(", ")}] in: ${body}`);
}

/**
 * Passes when an answer that leaves out a question names it in the reasons, so that the user sees
 * what the sender was not told (product decision 0006).
 */
export function gradeLeftOutReported(
  output: PipelineCaseOutput,
  leavesOut: boolean | undefined,
): Verdict {
  const { outcome, reasons } = output.result;

  if (!leavesOut || outcome !== "answer") {
    return notApplicable;
  }

  return reasons.some((reason) => reason.trim())
    ? pass
    : fail("The answer leaves out a question and has no reason that names it");
}

/** Passes when an escalation says why and carries neither a body nor citations. */
export function gradeEscalation(output: PipelineCaseOutput): Verdict {
  const { outcome, reasons, body, citations } = output.result;

  if (outcome !== "escalate") {
    return notApplicable;
  }

  const problems = [
    ...(reasons.some((reason) => reason.trim()) ? [] : ["it has no reason"]),
    ...(body ? ["it has a body"] : []),
    ...(citations.length > 0 ? ["it has citations"] : []),
  ];

  return problems.length === 0 ? pass : fail(`The escalation is wrong: ${problems.join(", ")}`);
}

/**
 * Passes when the stages ran as the pipeline defines. A run that triage ends, because the email
 * does not address the user or because triage is not confident, runs no later stage. An answer
 * has a content draft that the content judge passed, within the revision limit. When the case
 * names it, the style stage was skipped, or ran and its styled reply was accepted.
 */
export function gradeSteps(
  output: PipelineCaseOutput,
  style: StyleExpectation | undefined,
): Verdict {
  const { result } = output;

  if (!result.triage) {
    return fail("Triage did not run");
  }

  const endedAtTriage =
    result.outcome === "ignore" || result.triage.confidence < MIN_TRIAGE_CONFIDENCE;

  if (endedAtTriage) {
    return result.playbooks.length === 0 && result.evaluations.length === 0
      ? pass
      : fail("A stage ran after triage ended the run");
  }

  if (result.outcome !== "answer") {
    return pass;
  }

  const content = result.evaluations.filter((entry) => entry.stage === "content");
  const styled = result.evaluations.filter((entry) => entry.stage === "style");

  if (!content.at(-1)?.pass) {
    return fail("The answer has no content draft that the content judge passed");
  }

  if (result.revisions > MAX_REVISIONS) {
    return fail(`${result.revisions} revisions, at most ${MAX_REVISIONS} allowed`);
  }

  if (style === "skipped" && styled.length > 0) {
    return fail("The style stage ran");
  }

  if (style === "passed" && !styled.at(-1)?.pass) {
    return fail(
      styled.length === 0
        ? "The style stage did not run"
        : `The styled reply was not used: ${result.reasons.join(" ")}`,
    );
  }

  return pass;
}
