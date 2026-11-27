import { evaluateEmailConditions } from "@leren/auto-reply";
import { channelAccounts, messages, playbooks, replyConditions, users } from "@leren/db";
import type { Db } from "@leren/db";
import { deleteReceivedMessage, transitionMessage } from "@leren/inbox";
import type { EmailProcessMessage } from "@leren/inbox";
import { isKnowledgeUsable } from "@leren/knowledge";
import { and, eq } from "drizzle-orm";

import { emailSettingsSchema } from "./schema";

export type EmailGateDependencies = {
  db: Db;
  /** Publishes a message that passed the gate to `email.process`. */
  publishProcess: (message: EmailProcessMessage) => Promise<void>;
};

/**
 * What the gate did. `queued` means that the message was published to `email.process`. `deleted`
 * means that no playbook handles it, so its record was deleted. `ignored` means that the record was
 * gone or had already left the gate, so nothing was done.
 */
export type GateOutcome = "queued" | "deleted" | "ignored";

/**
 * Returns the names that a mention of the user may use: the first name, the last name, both
 * together and the display name.
 */
function namesOf(user: {
  firstName: string | null;
  lastName: string | null;
  name: string;
}): string[] {
  const full = [user.firstName, user.lastName].filter(Boolean).join(" ");

  return [user.firstName, user.lastName, full, user.name].flatMap((name) => name?.trim() || []);
}

/**
 * Deletes the record of a message that no playbook handles. A record that has moved on, such as one
 * that was already queued and published, is left as it is and the outcome is `ignored`, so the
 * pipeline never loses a record that it was given.
 */
async function deleteSkipped(db: Db, messageId: string): Promise<GateOutcome> {
  return (await deleteReceivedMessage(db, messageId)) ? "deleted" : "ignored";
}

/**
 * Decides whether a recorded message is handled (decisions 0039 and 0064). The decision is code
 * only and calls no model. A message that no playbook handles is deleted, so the database keeps
 * only the messages that the pipeline considers. The function reads the current row and never
 * trusts a message about its state, so a repeated or reordered `email.received` leaves the same
 * result: a record that has left `received` and `queued` is ignored, and a `queued` record is
 * published again, which repairs a publish that was lost after the status changed.
 *
 * The playbooks considered are the user's, are usable at `now` according to `isKnowledgeUsable`,
 * and name the channel account that the message arrived on. An account that was deleted or revoked
 * has no playbooks to consider. A playbook whose stored email settings are invalid is not
 * evaluated.
 */
export async function gateMessage(
  { db, publishProcess }: EmailGateDependencies,
  messageId: string,
  now: Date = new Date(),
): Promise<GateOutcome> {
  const [message] = await db.select().from(messages).where(eq(messages.id, messageId));

  if (!message || (message.status !== "received" && message.status !== "queued")) {
    return "ignored";
  }

  const { channelAccountId } = message;

  const [account] = channelAccountId
    ? await db
        .select({ label: channelAccounts.label, status: channelAccounts.status })
        .from(channelAccounts)
        .where(
          and(eq(channelAccounts.id, channelAccountId), eq(channelAccounts.userId, message.userId)),
        )
    : [];

  if (!channelAccountId || !account || account.status !== "active") {
    return deleteSkipped(db, messageId);
  }

  const [[user], rows] = await Promise.all([
    db.select().from(users).where(eq(users.id, message.userId)),
    db
      .select({ playbook: playbooks, settings: replyConditions.settings })
      .from(replyConditions)
      .innerJoin(playbooks, eq(playbooks.id, replyConditions.playbookId))
      .where(
        and(
          eq(playbooks.userId, message.userId),
          eq(replyConditions.channel, message.channel),
          eq(replyConditions.channelAccountId, channelAccountId),
        ),
      ),
  ]);

  const facts = {
    from: message.fromAddress,
    to: message.toAddresses,
    cc: message.ccAddresses,
    body: message.body,
    isReply: message.isReply,
    isBulk: message.isBulk,
  };

  const recipient = { email: account.label, names: user ? namesOf(user) : [] };
  const verdicts: EmailProcessMessage["playbooks"] = [];

  for (const { playbook, settings } of rows) {
    const parsed = emailSettingsSchema.safeParse(settings);

    if (!parsed.success || !isKnowledgeUsable(playbook, now)) {
      continue;
    }

    const verdict = evaluateEmailConditions(parsed.data, facts, recipient);

    if (verdict.outcome !== "skip") {
      verdicts.push({
        playbookId: playbook.id,
        verdict: verdict.outcome === "handle" ? "handle" : "check_mention",
      });
    }
  }

  if (verdicts.length === 0) {
    return deleteSkipped(db, messageId);
  }

  const moved = await transitionMessage(db, messageId, "queued");

  if (!moved && message.status !== "queued") {
    return "ignored";
  }

  await publishProcess({ messageId, playbooks: verdicts });

  return "queued";
}
