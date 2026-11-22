import type { McpWriteOutcome } from "@leren/mcp-server";
import type { z } from "zod";

/** The outcome of a write tool that is called without naming a field to change. */
export const NOTHING_TO_CHANGE: McpWriteOutcome = {
  status: "invalid",
  message: "Name at least one field to change",
};

/**
 * Drops the keys whose value is `undefined`, so that a default or a stored value is not
 * overwritten by a field that the caller left out.
 */
export function definedOnly<T extends Record<string, unknown>>(values: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

/**
 * Reports a schema failure to the caller of a write tool, one line for each issue.
 */
export function invalid(error: z.ZodError): McpWriteOutcome {
  const message = error.issues
    .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
    .join("; ");

  return { status: "invalid", message };
}
