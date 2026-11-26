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
  /(don['’]?t|do not|doesn['’]?t|does not) (have|see|hold|contain)/i,
  /(haven['’]?t|have not|hasn['’]?t|has not) (created|added|set up)/i,
  /(couldn['’]?t|could not|can['’]?t|cannot|didn['’]?t|did not) find/i,
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

/**
 * The one write that a run must make. `includes` are arguments that must equal the given value,
 * `instants` are date arguments that must fall in an inclusive range of ISO times, and `omits` are
 * arguments that the call must not name.
 */
export type WriteExpectation = {
  tool: "create_playbook" | "update_playbook";
  includes: Readonly<Record<string, unknown>>;
  instants?: Readonly<Record<string, readonly [string, string]>>;
  omits?: readonly string[];
};

const WRITE_TOOLS = /^(create_playbook|update_playbook)$/;

/**
 * Passes when the run made exactly one write call, with the expected tool, the expected argument
 * values, the date arguments inside their ranges and none of the omitted arguments.
 */
export function gradeWrite(
  toolCalls: readonly ToolCall[],
  expected: WriteExpectation | undefined,
): Verdict {
  if (!expected) {
    return { pass: true };
  }

  const writes = toolCalls.filter((call) => WRITE_TOOLS.test(call.name));
  const [call] = writes;

  if (writes.length !== 1 || call?.name !== expected.tool) {
    return {
      pass: false,
      comment: `Expected one ${expected.tool} call, got [${writes.map((write) => write.name).join(", ")}]`,
    };
  }

  const wrong = Object.entries(expected.includes)
    .filter(([key, value]) => call.input[key] !== value)
    .map(([key]) => key);

  const outside = Object.entries(expected.instants ?? {})
    .filter(([key, [from, to]]) => {
      const value = call.input[key];
      const time = typeof value === "string" ? Date.parse(value) : Number.NaN;

      return !(time >= Date.parse(from) && time <= Date.parse(to));
    })
    .map(([key]) => key);

  const extra = (expected.omits ?? []).filter((key) => call.input[key] !== undefined);

  return wrong.length + outside.length + extra.length === 0
    ? { pass: true }
    : {
        pass: false,
        comment: `Wrong values: [${wrong.join(", ")}]. Dates out of range: [${outside.join(", ")}]. Unrequested arguments: [${extra.join(", ")}]. Call: ${JSON.stringify(call.input)}`,
      };
}

/**
 * Passes when the store holds the expected number of playbooks after the run. It catches a write
 * that succeeded, also when an earlier write in the same run failed.
 */
export function gradeStoreSize(output: AssistantEvalOutput, expected: number | undefined): Verdict {
  return expected === undefined || output.playbooks.length === expected
    ? { pass: true }
    : {
        pass: false,
        comment: `Expected ${expected} playbooks afterwards, found ${output.playbooks.length}.`,
      };
}
