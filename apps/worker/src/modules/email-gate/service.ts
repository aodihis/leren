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
  /** Publishes a gated message to email.process. */
  publishProcess: (message: EmailProcessMessage) => Promise<void>;
};

/** The outcome of a gate run. */
export type GateOutcome = "queued" | "not_applicable" | "ignored";

export const NO_ACTIVE_PLAYBOOK = "no_active_playbook";
export const ACCOUNT_UNAVAILABLE = "account_unavailable";

/** Returns the names a mention of the user may use. */
function namesOf(user: {
  firstName: string | null;
  lastName: string | null;
  name: string;
}): string[] {
  const full = [user.firstName, user.lastName].filter(Boolean).join(" ");

  return [user.firstName, user.lastName, full, user.name].flatMap((name) => name?.trim() || []);
}

/** Records that no playbook handles the message. */
async function settleNotApplicable(
  db: Db,
  messageId: string,
  reason: string,
): Promise<GateOutcome> {
  const changed = await transitionMessage(db, messageId, "not_applicable", reason);

  return changed ? "not_applicable" : "ignored";
}

/** Decides whether a message is handled. */
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
