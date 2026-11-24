import { messages } from "@leren/db";
import type { Db } from "@leren/db";
import { and, eq, inArray } from "drizzle-orm";

export type MessageStatus = (typeof messages.$inferSelect)["status"];

/** The statuses a message may move to. */
const TRANSITIONS: Record<MessageStatus, readonly MessageStatus[]> = {
  received: ["not_applicable", "queued", "failed"],
  queued: ["processing", "failed"],
  processing: ["drafted", "sent", "escalated", "not_applicable", "failed"],
  not_applicable: [],
  drafted: ["sent", "failed"],
  sent: [],
  escalated: [],
  failed: [],
};

/** Reports whether a status move is allowed. */
export function canTransition(from: MessageStatus, to: MessageStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Returns the statuses a message may come from. */
function statusesBefore(to: MessageStatus): MessageStatus[] {
  return (Object.keys(TRANSITIONS) as MessageStatus[]).filter((from) => canTransition(from, to));
}

/** Moves a message to a status when allowed. */
export async function transitionMessage(
  db: Db,
  messageId: string,
  to: MessageStatus,
  reason: string | null = null,
  only?: readonly MessageStatus[],
): Promise<boolean> {
  const now = new Date();
  const allowed = statusesBefore(to).filter((from) => !only || only.includes(from));

  const changed = await db
    .update(messages)
    .set({ status: to, statusReason: reason, statusChangedAt: now, updatedAt: now })
    .where(and(eq(messages.id, messageId), inArray(messages.status, allowed)))
    .returning({ id: messages.id });

  return changed.length > 0;
}
