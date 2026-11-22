import { randomUUID } from "node:crypto";

import { channelAccounts, messages } from "@leren/db";
import type { Db } from "@leren/db";
import { truncate } from "@leren/inbox";
import type { InboundEmail } from "@leren/inbox";
import { and, desc, eq, lt, or } from "drizzle-orm";

import { encodeCursor } from "./schema";
import type { MessageListQuery, SimulateEmailInput } from "./schema";

const PREVIEW_LENGTH = 300;

/** The provider whose accounts may receive simulated messages (decision 0039). */
export const SIMULATION_PROVIDER = "mailpit";

type MessageRow = typeof messages.$inferSelect;

/**
 * A message as the list returns it. `preview` is the start of the body, and the full body is
 * returned only for one message.
 */
export type MessageSummary = ReturnType<typeof toSummary>;

export type MessageDetail = MessageSummary & { body: string };

function toSummary(row: MessageRow) {
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
    .select()
    .from(messages)
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
  const last = page.at(-1);

  return {
    messages: page.map(toSummary),
    nextCursor: rows.length > limit && last ? encodeCursor(last) : null,
  };
}

/** Returns one message record with its stored body, or `null` when the user has no such record. */
export async function getMessage(
  db: Db,
  userId: string,
  messageId: string,
): Promise<MessageDetail | null> {
  const [row] = await db
    .select()
    .from(messages)
    .where(and(eq(messages.id, messageId), eq(messages.userId, userId)));

  return row ? { ...toSummary(row), body: row.body } : null;
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
