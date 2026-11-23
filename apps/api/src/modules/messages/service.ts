import { randomUUID } from "node:crypto";

import { channelAccounts, messages, playbooks, replyDecisions } from "@leren/db";
import type { Db } from "@leren/db";
import { truncate } from "@leren/inbox";
import type { InboundEmail } from "@leren/inbox";
import { and, desc, eq, inArray, lt, or } from "drizzle-orm";
import { z } from "zod";

import { encodeCursor } from "./schema";
import type { MessageListQuery, SimulateEmailInput } from "./schema";

const PREVIEW_LENGTH = 300;

/** The provider whose accounts may receive simulated messages (decision 0039). */
export const SIMULATION_PROVIDER = "mailpit";

type MessageRow = typeof messages.$inferSelect;

type DecisionRow = typeof replyDecisions.$inferSelect;

/**
 * A message as the list returns it. `preview` is the start of the body, and the full body is
 * returned only for one message. `outcome` and `deliveryState` come from the decision of the
 * pipeline and are null while there is none, and `deliveryState` is also null for a decision that
 * has no reply to deliver (decisions 0043 and 0046).
 */
export type MessageSummary = ReturnType<typeof toSummary>;

export type MessageDetail = MessageSummary & {
  body: string;
  decision: ReturnType<typeof toDecision> | null;
};

function toDecision(row: DecisionRow, cited: { id: string; topic: string }[]) {
  return {
    outcome: row.outcome,
    body: row.body,
    category: row.category,
    citations: row.citations,
    citedPlaybooks: cited,
    playbookIds: row.playbookIds,
    reasons: row.reasons,
    revisions: row.revisions,
    evaluations: row.evaluations,
    createdAt: row.createdAt.toISOString(),
    delivery: {
      mode: row.deliveryMode,
      state: row.deliveryState,
      request: row.deliveryRequest,
      response: row.deliveryResponse,
      attempts: row.deliveryAttempts,
      startedAt: row.deliveryStartedAt?.toISOString() ?? null,
      finishedAt: row.deliveryFinishedAt?.toISOString() ?? null,
      mailboxDraftId: row.mailboxDraftId,
      sentMessageId: row.sentMessageId,
      error: row.deliveryError,
    },
  };
}

function toSummary(row: MessageRow, decision: DecisionRow | null) {
  return {
    id: row.id,
    channel: row.channel,
    provider: row.provider,
    channelAccountId: row.channelAccountId,
    providerMessageId: row.providerMessageId,
    providerThreadId: row.providerThreadId,
    from: row.fromAddress,
    to: row.toAddresses,
    cc: row.ccAddresses,
    subject: row.subject,
    preview: truncate(row.body, PREVIEW_LENGTH).text,
    bodyTruncated: row.bodyTruncated,
    isReply: row.isReply,
    isBulk: row.isBulk,
    receivedAt: row.receivedAt.toISOString(),
    status: row.status,
    statusReason: row.statusReason,
    statusChangedAt: row.statusChangedAt.toISOString(),
    outcome: decision?.outcome ?? null,
    deliveryState: decision?.deliveryState ?? null,
  };
}

/**
 * Lists the user's message records, newest first, one page at a time. The query is scoped to
 * `userId`. One more row than the page size is read to learn whether a next page exists, and
 * `nextCursor` is null on the last page.
 */
export async function listMessages(
  db: Db,
  userId: string,
  query: MessageListQuery,
): Promise<{ messages: MessageSummary[]; nextCursor: string | null }> {
  const { status, channel, channelAccountId, cursor, limit } = query;

  const rows = await db
    .select({ message: messages, decision: replyDecisions })
    .from(messages)
    .leftJoin(replyDecisions, eq(replyDecisions.messageId, messages.id))
    .where(
      and(
        eq(messages.userId, userId),
        status ? eq(messages.status, status) : undefined,
        channel ? eq(messages.channel, channel) : undefined,
        channelAccountId ? eq(messages.channelAccountId, channelAccountId) : undefined,
        cursor
          ? or(
              lt(messages.receivedAt, cursor.receivedAt),
              and(eq(messages.receivedAt, cursor.receivedAt), lt(messages.id, cursor.id)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(messages.receivedAt), desc(messages.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const last = page.at(-1)?.message;

  return {
    messages: page.map((row) => toSummary(row.message, row.decision)),
    nextCursor: rows.length > limit && last ? encodeCursor(last) : null,
  };
}

/**
 * Returns one message record with its stored body and its decision, or `null` when the user has no
 * such record. The cited playbooks are the ones of the user that still exist, in the order of the
 * citations.
 */
export async function getMessage(
  db: Db,
  userId: string,
  messageId: string,
): Promise<MessageDetail | null> {
  const [row] = await db
    .select({ message: messages, decision: replyDecisions })
    .from(messages)
    .leftJoin(replyDecisions, eq(replyDecisions.messageId, messages.id))
    .where(and(eq(messages.id, messageId), eq(messages.userId, userId)));

  if (!row) {
    return null;
  }

  const { message, decision } = row;

  const citedIds = [...new Set(decision?.citations ?? [])].filter(
    (id) => z.uuid().safeParse(id).success,
  );

  const found =
    citedIds.length > 0
      ? await db
          .select({ id: playbooks.id, topic: playbooks.topic })
          .from(playbooks)
          .where(and(eq(playbooks.userId, userId), inArray(playbooks.id, citedIds)))
      : [];

  const cited = citedIds.flatMap((id) => found.filter((playbook) => playbook.id === id));

  return {
    ...toSummary(message, decision),
    body: message.body,
    decision: decision ? toDecision(decision, cited) : null,
  };
}

/**
 * Builds the email that a development provider would have delivered to the user's account on
 * `SIMULATION_PROVIDER`. Returns `null` when the user has no such account or it is not active.
 */
export async function buildSimulatedEmail(
  db: Db,
  userId: string,
  input: SimulateEmailInput,
  now: Date = new Date(),
): Promise<InboundEmail | null> {
  const [account] = await db
    .select()
    .from(channelAccounts)
    .where(
      and(
        eq(channelAccounts.userId, userId),
        eq(channelAccounts.provider, SIMULATION_PROVIDER),
        eq(channelAccounts.status, "active"),
      ),
    );

  if (!account) {
    return null;
  }

  return {
    userId,
    channelAccountId: account.id,
    channel: account.channel,
    provider: account.provider,
    providerMessageId: input.providerMessageId ?? `simulated-${randomUUID()}`,
    providerThreadId: input.providerThreadId ?? null,
    from: input.from,
    to: input.to ?? [account.label],
    cc: input.cc,
    subject: input.subject,
    body: input.body,
    isReply: input.isReply,
    isBulk: input.isBulk,
    receivedAt: now,
  };
}
