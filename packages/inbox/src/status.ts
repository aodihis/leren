import { messages } from "@leren/db";
import type { Db } from "@leren/db";
import { redactContactDetails } from "@leren/observability";
import { and, eq, inArray } from "drizzle-orm";

export type MessageStatus = (typeof messages.$inferSelect)["status"];

/**
 * The statuses that a message may move to from each status (decisions 0039, 0046 and 0064). A
 * status that maps to an empty list is final. A status only moves forward, so no path leads back to
 * an earlier one. A reply that is ready, `drafted`, is then sent or fails to be delivered. A
 * `received` message that the gate skips is deleted, so it never becomes `not_applicable`.
 */
const TRANSITIONS: Record<MessageStatus, readonly MessageStatus[]> = {
  received: ["queued", "failed"],
  queued: ["processing", "failed"],
  processing: ["drafted", "sent", "escalated", "not_applicable", "failed"],
  not_applicable: [],
  drafted: ["sent", "failed"],
  sent: [],
  escalated: [],
  failed: [],
};

/**
 * The statuses that end the processing of a message's text. When a message moves to one of them,
 * its subject and body are redacted. A message that is `drafted` is not in the list, because the
 * delivery of its reply still reads the subject. `redactMessageText` is called when that delivery
 * ends.
 */
const REDACTED_ON_ENTRY: readonly MessageStatus[] = [
  "not_applicable",
  "sent",
  "escalated",
  "failed",
];

/**
 * Replaces the email addresses and phone numbers in the subject and the body of a message with
 * `[redacted]`. The addresses of the sender and the recipients are kept, because the rules and the
 * delivery of a reply read them. It is safe to call again, because redacted text is unchanged.
 */
export async function redactMessageText(
  db: Pick<Db, "select" | "update">,
  messageId: string,
): Promise<void> {
  const [row] = await db
    .select({ subject: messages.subject, body: messages.body })
    .from(messages)
    .where(eq(messages.id, messageId));

  if (!row) {
    return;
  }

  await db
    .update(messages)
    .set({ subject: redactContactDetails(row.subject), body: redactContactDetails(row.body) })
    .where(eq(messages.id, messageId));
}

/** Reports whether a message in status `from` may move to status `to`. */
export function canTransition(from: MessageStatus, to: MessageStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Returns the statuses from which a message may move to `to`. */
function statusesBefore(to: MessageStatus): MessageStatus[] {
  return (Object.keys(TRANSITIONS) as MessageStatus[]).filter((from) => canTransition(from, to));
}

/**
 * Deletes a message that the gate skips (decision 0064), but only while its stored status is
 * `received`. The check and the delete are one conditional statement, so a record that another
 * worker has already queued is never deleted. Returns whether the record was deleted.
 */
export async function deleteReceivedMessage(db: Db, messageId: string): Promise<boolean> {
  const deleted = await db
    .delete(messages)
    .where(and(eq(messages.id, messageId), eq(messages.status, "received")))
    .returning({ id: messages.id });

  return deleted.length > 0;
}

/**
 * Moves a message to `to` and stores the reason, but only when its stored status allows the move.
 * The check and the write are one conditional update, so two workers that race, a repeated
 * message and a message that arrives late cannot move a record backwards. Returns whether the
 * status changed. A message that is already in `to` is left alone and reports `false`. When
 * `only` is given, the move is also limited to messages that are in one of those statuses, so a
 * stage cannot fail a message that a later stage has taken over. A move to a status that ends the
 * processing of the text redacts the subject and the body in the same transaction.
 */
export async function transitionMessage(
  db: Db,
  messageId: string,
  to: MessageStatus,
  reason: string | null = null,
  only?: readonly MessageStatus[],
): Promise<boolean> {
  const now = new Date();
  const allowed = statusesBefore(to).filter((from) => !only || only.includes(from));

  const move = async (executor: Pick<Db, "update">) =>
    executor
      .update(messages)
      .set({ status: to, statusReason: reason, statusChangedAt: now, updatedAt: now })
      .where(and(eq(messages.id, messageId), inArray(messages.status, allowed)))
      .returning({ id: messages.id });

  if (!REDACTED_ON_ENTRY.includes(to)) {
    return (await move(db)).length > 0;
  }

  return db.transaction(async (tx) => {
    const changed = await move(tx);

    if (changed.length > 0) {
      await redactMessageText(tx, messageId);
    }

    return changed.length > 0;
  });
}
