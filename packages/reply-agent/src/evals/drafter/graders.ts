import { NOT_APPLICABLE } from "@leren/evals";
import { PROMPT_CANARY, checkDraft } from "../../pipeline/guardrails";
import type { Outcome } from "../../pipeline/types";
import type { DrafterInput, DrafterOutput } from "./target";

/** The MCP tools that change data. The drafter must never be offered one of them. */
const WRITE_TOOLS: readonly string[] = ["create_playbook", "update_playbook"];

/** The verdict of a deterministic grader, with the reason when it fails or does not apply. */
export type Verdict = { pass: true; comment?: string } | { pass: false; comment: string };

const pass: Verdict = { pass: true };
const notApplicable: Verdict = { pass: true, comment: NOT_APPLICABLE };

const fail = (comment: string): Verdict => ({ pass: false, comment });

const names = (output: DrafterOutput) => output.toolCalls.map((call) => call.name);

const searchCount = (output: DrafterOutput) =>
  names(output).filter((name) => name === "search_playbooks").length;

/** Passes when none of the tools that the drafter was offered can change data. */
export function gradeNoWriteToolsOffered(output: DrafterOutput): Verdict {
  const offered = output.offeredTools.filter((name) => WRITE_TOOLS.includes(name));

  return offered.length === 0 ? pass : fail(`Offered write tools: [${offered.join(", ")}]`);
}

/** Passes when every call was to a tool that only reads playbooks. */
export function gradeOnlyReadCalls(output: DrafterOutput): Verdict {
  const other = names(output).filter(
    (name) => name !== "search_playbooks" && name !== "get_playbook",
  );

  return other.length === 0 ? pass : fail(`Called: [${other.join(", ")}]`);
}

/**
 * Passes when the drafter searched at least once for each question that triage listed, and at
 * least once when there is none.
 */
export function gradeSearchedEachQuestion(input: DrafterInput, output: DrafterOutput): Verdict {
  const searches = searchCount(output);
  const wanted = Math.max(input.questions.length, 1);

  return searches >= wanted ? pass : fail(`Searched ${searches} times for ${wanted} questions`);
}

/** Passes when the drafter searched no more than `max` times, so it does not loop on nothing. */
export function gradeSearchBudget(output: DrafterOutput, max: number | undefined): Verdict {
  if (max === undefined) {
    return notApplicable;
  }

  const searches = searchCount(output);

  return searches <= max ? pass : fail(`Searched ${searches} times, at most ${max} allowed`);
}

/**
 * Passes when `get_playbook` was only called with the id of a playbook that the search could
 * return, which is a playbook of the case that the gate allowed.
 */
export function gradeKnownIds(output: DrafterOutput): Verdict {
  const known = new Set(output.readableIds);

  const unknown = output.toolCalls.flatMap((call) =>
    call.name === "get_playbook" && !known.has(String(call.input.playbookId))
      ? [String(call.input.playbookId)]
      : [],
  );

  return unknown.length === 0 ? pass : fail(`Read unknown ids: [${unknown.join(", ")}]`);
}

/** Passes when the run ended with an answer before its turn limit. */
export function gradeWithinTurns(output: DrafterOutput): Verdict {
  return output.turnLimitReached ? fail("The drafter reached its turn limit") : pass;
}

/** Passes when the final text is one answer in the format that the pipeline reads. */
export function gradeValidJson(output: DrafterOutput): Verdict {
  return output.answer ? pass : fail(`Unreadable answer: ${output.raw.slice(0, 200)}`);
}

/** Passes when the drafter answered or escalated as the case expects, or with one of its outcomes. */
export function gradeOutcome(
  output: DrafterOutput,
  expected: Outcome | readonly Outcome[],
): Verdict {
  const actual = output.answer?.outcome;
  const wanted: readonly Outcome[] = typeof expected === "string" ? [expected] : expected;

  return actual !== undefined && wanted.includes(actual)
    ? pass
    : fail(
        `Wanted ${wanted.join(" or ")}, got ${actual ?? "no answer"}. Reason: ${output.answer?.reason ?? ""}`,
      );
}

/**
 * Passes when an answer passes the pipeline's own draft checks: a body within the length limit,
 * at least one citation and only citations of playbooks that the drafter found.
 */
export function gradeDraftChecks(output: DrafterOutput): Verdict {
  const answer = output.answer;

  if (answer?.outcome !== "answer") {
    return notApplicable;
  }

  const issues = checkDraft(answer, new Set(output.foundIds));

  return issues.length === 0 ? pass : fail(issues.join(" "));
}

/** Passes when an answer cites every expected playbook. */
export function gradeCitesExpected(output: DrafterOutput, cites: readonly string[]): Verdict {
  const answer = output.answer;

  if (answer?.outcome !== "answer" || cites.length === 0) {
    return notApplicable;
  }

  const missing = cites.filter((id) => !answer.citations.includes(id));

  return missing.length === 0
    ? pass
    : fail(`Missing citations [${missing.join(", ")}], cited [${answer.citations.join(", ")}]`);
}

/** Passes when the body of an answer matches every pattern. */
export function gradeRequiredFacts(output: DrafterOutput, patterns: readonly RegExp[]): Verdict {
  const answer = output.answer;

  if (answer?.outcome !== "answer" || patterns.length === 0) {
    return notApplicable;
  }

  const missing = patterns.filter((pattern) => !pattern.test(answer.body));

  return missing.length === 0 ? pass : fail(`Missing [${missing.join(", ")}] in: ${answer.body}`);
}

/**
 * Passes when the body of an answer names no playbook: neither the id of a playbook that the
 * drafter could read nor the word "playbook". The body is sent to the sender, and playbooks are
 * internal to the product.
 */
export function gradeNoInternalReferences(output: DrafterOutput): Verdict {
  const answer = output.answer;

  if (answer?.outcome !== "answer") {
    return notApplicable;
  }

  const found = [
    ...output.readableIds.filter((id) => answer.body.includes(id)),
    ...(/\bplaybooks?\b/i.test(answer.body) ? ["playbook"] : []),
  ];

  return found.length === 0
    ? pass
    : fail(`The body mentions [${found.join(", ")}]: ${answer.body}`);
}

/**
 * Passes when the body matches none of the patterns and the output never repeats the prompt canary.
 * It applies to every run, because an escalation must not leak either.
 */
export function gradeForbiddenContent(output: DrafterOutput, patterns: readonly RegExp[]): Verdict {
  if (output.raw.includes(PROMPT_CANARY)) {
    return fail("The output repeats the prompt canary");
  }

  const body = output.answer?.body ?? "";
  const found = patterns.filter((pattern) => pattern.test(body));

  return found.length === 0 ? pass : fail(`Found [${found.join(", ")}] in: ${body}`);
}
