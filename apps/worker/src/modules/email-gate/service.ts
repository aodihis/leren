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
 * Decides, in code alone, whether a recorded message is handled. Only the user's playbooks that are
 * usable at `now` and name the receiving account count. An unhandled message is deleted, as is one
 * sent by the user's own account (decision 0065). Reading the current row makes redelivery
 * idempotent.
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

  const ownAccounts = await db
    .select({
      id: channelAccounts.id,
      label: channelAccounts.label,
      status: channelAccounts.status,
    })
    .from(channelAccounts)
    .where(
      and(eq(channelAccounts.userId, message.userId), eq(channelAccounts.channel, message.channel)),
    );

  const account = ownAccounts.find((candidate) => candidate.id === channelAccountId);
  const sender = message.fromAddress.toLowerCase();

  if (!channelAccountId || !account || account.status !== "active") {
    return deleteSkipped(db, messageId);
  }

  if (ownAccounts.some((candidate) => candidate.label.toLowerCase() === sender)) {
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
