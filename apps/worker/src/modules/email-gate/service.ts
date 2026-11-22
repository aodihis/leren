import { evaluateEmailConditions } from "@leren/auto-reply";
import { channelAccounts, messages, playbooks, replyConditions, users } from "@leren/db";
import type { Db } from "@leren/db";
import { transitionMessage } from "@leren/inbox";
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
 * What the gate did. `queued` means that the message was published to `email.process`.
 * `not_applicable` means that no playbook handles it. `ignored` means that the record was gone or
 * had already left the gate, so nothing was done.
 */
export type GateOutcome = "queued" | "not_applicable" | "ignored";

export const NO_ACTIVE_PLAYBOOK = "no_active_playbook";
export const ACCOUNT_UNAVAILABLE = "account_unavailable";

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
 * Records that no playbook handles the message. The outcome is `not_applicable` only when the
 * record changed. A record that cannot move there, such as one that was already queued and
 * published, is left as it is and the outcome is `ignored`, so the outcome never claims a status
 * that was not written.
 */
async function settleNotApplicable(
  db: Db,
  messageId: string,
  reason: string,
): Promise<GateOutcome> {
  const changed = await transitionMessage(db, messageId, "not_applicable", reason);

  return changed ? "not_applicable" : "ignored";
}

/**
 * Decides whether a recorded message is handled, and records the decision (decision 0039). The
 * decision is code only and calls no model. The function reads the current row and never trusts a
 * message about its state, so a repeated or reordered `email.received` leaves the same result:
 * a record that has left `received` and `queued` is ignored, and a `queued` record is published
 * again, which repairs a publish that was lost after the status changed.
 *
 * The playbooks considered are the user's, are usable at `now` according to `isKnowledgeUsable`,
 * and name the channel account that the message arrived on. An account that was deleted or revoked
 * has no playbooks to consider. A playbook whose stored email settings are invalid is not
 * evaluated. The reason of a `not_applicable` record is `no_active_playbook` when no playbook was
 * considered, and otherwise the reason of the first playbook that skipped the message.
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
    return settleNotApplicable(db, messageId, ACCOUNT_UNAVAILABLE);
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
  let skipReason: string | null = null;

  for (const { playbook, settings } of rows) {
    const parsed = emailSettingsSchema.safeParse(settings);

    if (!parsed.success || !isKnowledgeUsable(playbook, now)) {
      continue;
    }

    const verdict = evaluateEmailConditions(parsed.data, facts, recipient);

    if (verdict.outcome === "skip") {
      skipReason ??= verdict.reason;
    } else {
      verdicts.push({
        playbookId: playbook.id,
        verdict: verdict.outcome === "handle" ? "handle" : "check_mention",
      });
    }
  }

  if (verdicts.length === 0) {
    return settleNotApplicable(db, messageId, skipReason ?? NO_ACTIVE_PLAYBOOK);
  }

  const moved = await transitionMessage(db, messageId, "queued");

  if (!moved && message.status !== "queued") {
    return "ignored";
  }

  await publishProcess({ messageId, playbooks: verdicts });

  return "queued";
}
