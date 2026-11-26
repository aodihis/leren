import type { AssistantEvalOutput, ToolCall } from "./target";

/** The verdict of a deterministic grader, with the reason when it fails. */
export type Verdict = { pass: true } | { pass: false; comment: string };

/**
 * Which tools a run must and must not call. Each entry is a regular expression that is matched
 * against the whole tool name, so `"get_playbook|list_playbooks"` accepts either tool.
 */
export type ToolExpectation = {
  mustCall?: readonly string[];
  mustNotCall?: readonly string[];
};

/**
 * Passes when every required tool was called at least once and no forbidden tool was called. A
 * pattern never matches part of a tool name.
 */
export function gradeToolCalls(
  toolCalls: readonly ToolCall[],
  expected: ToolExpectation | undefined,
): Verdict {
  const names = toolCalls.map((call) => call.name);

  const matches = (pattern: string) =>
    names.some((name) => new RegExp(`^(${pattern})$`).test(name));

  const missing = (expected?.mustCall ?? []).filter((pattern) => !matches(pattern));
  const forbidden = (expected?.mustNotCall ?? []).filter(matches);

  return missing.length === 0 && forbidden.length === 0
    ? { pass: true }
    : {
        pass: false,
        comment: `Missing: [${missing.join(", ")}]. Forbidden but called: [${forbidden.join(", ")}]. Called: [${names.join(", ")}]`,
      };
}

/**
 * Passes when the run read the playbook store with a tool and left an empty store empty. A run that
 * answers without reading, or that creates a playbook, fails.
 */
export function gradeReadsAndKeepsEmpty(output: AssistantEvalOutput): Verdict {
  const names = output.toolCalls.map((call) => call.name);
  const read = names.some((name) => /^(list_playbooks|get_playbook|search_playbooks)$/.test(name));

  return read && output.playbooks.length === 0
    ? { pass: true }
    : {
        pass: false,
        comment: `Read: ${read}. Playbooks afterwards: ${output.playbooks.length}. Called: [${names.join(", ")}]`,
      };
}

/** The ways that a reply says that it found no playbook. */
export const NOTHING_FOUND_PATTERNS: readonly RegExp[] = [
  /\bno\b[^.]*\bplaybooks?/i,
  /(don'?t|do not|doesn'?t|does not) (have|see|hold|contain)/i,
  /(haven'?t|have not|hasn'?t|has not) (created|added|set up)/i,
  /(couldn'?t|could not|can'?t|cannot|didn'?t|did not) find/i,
  /\bnone\b|\bempty\b|\bnot any\b|\bno (matching|such)\b/i,
  /not (yet )?(created|set up|have)/i,
];

/**
 * Joins patterns into one case-insensitive pattern that matches when any of them does. An empty
 * list gives a pattern that matches nothing, so that "must not match" passes for it.
 */
export function anyOf(patterns: readonly RegExp[]): RegExp {
  return patterns.length === 0
    ? /(?!)/
    : new RegExp(patterns.map((pattern) => pattern.source).join("|"), "i");
}
