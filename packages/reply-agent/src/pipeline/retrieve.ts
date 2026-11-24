import type { Message } from "@anvia/core";
import { playbookSchema } from "./types";
import type { Playbook, Retrieval } from "./types";

const MAX_DEPTH = 8;

/** The MCP tools whose results are playbooks. */
const PLAYBOOK_TOOLS = ["search_playbooks", "list_playbooks", "get_playbook"];

/** Collects every playbook in a value. */
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

/** Returns the playbooks in a tool result. */
export function readPlaybooks(value: unknown): Playbook[] {
  const found: Playbook[] = [];

  walk(value, found, 0);

  return mergePlaybooks([], found);
}

/** Keeps the playbooks whose id is allowed. */
export function keepAllowed(
  playbooks: readonly Playbook[],
  allowed: ReadonlySet<string> | undefined,
): Playbook[] {
  return allowed ? playbooks.filter((playbook) => allowed.has(playbook.id)) : [...playbooks];
}

/** Joins two playbook lists without repeats. */
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

/** Reads the result of the search tool. */
export function parseSearchResult(data: unknown): Retrieval {
  const playbooks = readPlaybooks(data);

  return playbooks.length === 0 ? { status: "no_reliable_result" } : { status: "ok", playbooks };
}

/** Returns the playbooks that an agent run returned. */
export function collectPlaybooks(messages: readonly Message[]): Playbook[] {
  const found: Playbook[] = [];

  for (const message of messages) {
    if (message.role !== "tool") {
      continue;
    }

    for (const part of message.content) {
      if (
        part.type === "tool-result" &&
        PLAYBOOK_TOOLS.some((name) => part.toolName.endsWith(name)) &&
        part.output.type !== "execution-denied"
      ) {
        walk(part.output.value, found, 0);
      }
    }
  }

  return mergePlaybooks([], found);
}
