import type { Message } from "@anvia/core";
import { playbookSchema } from "./types";
import type { Playbook } from "./types";

const MAX_DEPTH = 8;

/** The MCP tools whose results are playbooks. The results of any other tool are not read. */
const PLAYBOOK_TOOLS = ["search_playbooks", "list_playbooks", "get_playbook"];

/**
 * Collects every playbook in a value of unknown shape. A string is read as JSON when it parses, so
 * the walker accepts the text of an MCP result, the object inside it and any wrapper around it. A
 * playbook that the server marks as not usable is skipped.
 */
function walk(value: unknown, found: Playbook[], depth: number): void {
  if (depth > MAX_DEPTH) {
    return;
  }

  if (typeof value === "string") {
    try {
      walk(JSON.parse(value), found, depth + 1);
    } catch {
      return;
    }

    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      walk(item, found, depth + 1);
    }

    return;
  }

  if (typeof value !== "object" || value === null) {
    return;
  }

  const parsed = playbookSchema.safeParse(value);

  if (parsed.success && (value as { usable?: unknown }).usable !== false) {
    found.push(parsed.data);

    return;
  }

  for (const child of Object.values(value)) {
    walk(child, found, depth + 1);
  }
}

/** Returns the playbooks inside a tool result, in order, without repeats. */
export function readPlaybooks(value: unknown): Playbook[] {
  const found: Playbook[] = [];

  walk(value, found, 0);

  return mergePlaybooks([], found);
}

/**
 * Keeps the playbooks whose id is in `allowed`, or all of them when there is no allowed set. The
 * gate decides which playbooks may reply to a message, and a playbook that retrieval finds outside
 * that set must not be used.
 */
export function keepAllowed(
  playbooks: readonly Playbook[],
  allowed: ReadonlySet<string> | undefined,
): Playbook[] {
  return allowed ? playbooks.filter((playbook) => allowed.has(playbook.id)) : [...playbooks];
}

/** Joins two lists of playbooks and keeps the first one of each id. */
export function mergePlaybooks(
  first: readonly Playbook[],
  second: readonly Playbook[],
): Playbook[] {
  const byId = new Map<string, Playbook>();

  for (const playbook of [...first, ...second]) {
    if (!byId.has(playbook.id)) {
      byId.set(playbook.id, playbook);
    }
  }

  return [...byId.values()];
}

/** The outputs of the named tools in the messages of an agent run, in order. */
function toolOutputs(messages: readonly Message[], tools: readonly string[]) {
  return messages.flatMap((message) =>
    message.role === "tool"
      ? message.content.flatMap((part) =>
          part.type === "tool-result" && tools.some((name) => part.toolName.endsWith(name))
            ? [part.output]
            : [],
        )
      : [],
  );
}

/**
 * Returns the playbooks that the playbook tools of an agent run returned. These are the only
 * playbooks that the answering agent found, so the checks of the pipeline accept citations of them
 * and no others.
 */
export function collectPlaybooks(messages: readonly Message[]): Playbook[] {
  const found: Playbook[] = [];

  for (const output of toolOutputs(messages, PLAYBOOK_TOOLS)) {
    if (output.type === "text" || output.type === "json" || output.type === "content") {
      walk(output.value, found, 0);
    }
  }

  return mergePlaybooks([], found);
}

/**
 * Whether `search_playbooks` failed during an agent run. Its only argument is a free-text query, so
 * a failed search is a server, authorization or connection problem and not an answer without a
 * playbook, and the caller must not record it as an escalation. An error of `get_playbook` is not
 * counted, because the server also reports an unknown or malformed id that the model passed as an
 * error, and the agent can read that error and carry on.
 */
export function playbookSearchFailed(messages: readonly Message[]): boolean {
  return toolOutputs(messages, ["search_playbooks"]).some(
    (output) => output.type === "error-text" || output.type === "error-json",
  );
}
