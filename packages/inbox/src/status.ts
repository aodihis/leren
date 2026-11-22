import { messages } from "@leren/db";
import type { Db } from "@leren/db";
import { and, eq, inArray } from "drizzle-orm";

export type MessageStatus = (typeof messages.$inferSelect)["status"];

/**
 * The statuses that a message may move to from each status (decision 0039). A status that maps to
 * an empty list is final. A status only moves forward, so no path leads back to an earlier one.
 */
const TRANSITIONS: Record<MessageStatus, readonly MessageStatus[]> = {
  received: ["not_applicable", "queued", "failed"],
  queued: ["processing", "failed"],
  processing: ["drafted", "sent", "not_applicable", "failed"],
  not_applicable: [],
  drafted: [],
  sent: [],
  failed: [],
};

/** Reports whether a message in status `from` may move to status `to`. */
export function canTransition(from: MessageStatus, to: MessageStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Returns the statuses from which a message may move to `to`. */
function statusesBefore(to: MessageStatus): MessageStatus[] {
  return (Object.keys(TRANSITIONS) as MessageStatus[]).filter((from) => canTransition(from, to));
}

/**
 * Moves a message to `to` and stores the reason, but only when its stored status allows the move.
 * The check and the write are one conditional update, so two workers that race, a repeated
 * message and a message that arrives late cannot move a record backwards. Returns whether the
 * status changed. A message that is already in `to` is left alone and reports `false`.
 */
export async function transitionMessage(
  db: Db,
  messageId: string,
  to: MessageStatus,
  reason: string | null = null,
): Promise<boolean> {
  const now = new Date();

  const changed = await db
    .update(messages)
    .set({ status: to, statusReason: reason, statusChangedAt: now, updatedAt: now })
    .where(and(eq(messages.id, messageId), inArray(messages.status, statusesBefore(to))))
    .returning({ id: messages.id });

  return changed.length > 0;
}
