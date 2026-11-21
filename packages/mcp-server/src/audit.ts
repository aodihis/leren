import { mcpAuditLog } from "@leren/db";
import type { Db } from "@leren/db";

import type { McpSession } from "./sessions";

export type AuditOutcome = "ok" | "not_found" | "invalid" | "unavailable" | "rejected";

/**
 * Records one tool call. `summary` holds identifiers and counts only. It must never hold a token
 * or the text of a knowledge item.
 */
export async function writeAudit(
  db: Db,
  session: McpSession,
  tool: string,
  outcome: AuditOutcome,
  summary: Record<string, unknown>,
): Promise<void> {
  await db.insert(mcpAuditLog).values({
    userId: session.userId,
    sessionId: session.id,
    tool,
    outcome,
    summary,
  });
}
