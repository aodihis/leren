import { messages } from "@leren/db";
import type { Db } from "@leren/db";
import type { QueueClient } from "@leren/queue";
import { and, eq } from "drizzle-orm";

/** The name of the queue that carries a recorded message to the gate. */
export const EMAIL_RECEIVED_QUEUE = "email.received";

/** The name of the queue that carries a message that passed the gate to the pipeline. */
export const EMAIL_PROCESS_QUEUE = "email.process";

/** The name of the queue that carries a reply that is ready to the deliverer (decision 0046). */
export const EMAIL_DELIVER_QUEUE = "email.deliver";

/** The most characters of a body that the record keeps. */
export const MESSAGE_BODY_LIMIT = 20_000;

/** The most characters of a subject that the record keeps. */
export const MESSAGE_SUBJECT_LIMIT = 500;

/**
 * The message of `email.received`. It names the record and nothing else, so the gate reads the
 * current row.
 */
export type EmailReceivedMessage = { messageId: string };

/**
 * An email as a provider delivers it, before it is recorded. `providerMessageId` is the provider's
 * own identifier and is what makes recording idempotent. Addresses are plain addresses without
 * display names.
 */
export type InboundEmail = {
  userId: string;
  channelAccountId: string;
  channel: string;
  provider: string;
  providerMessageId: string;
  providerThreadId?: string | null;
  from: string;
  to: readonly string[];
  cc?: readonly string[];
  subject: string;
  body: string;
  isReply?: boolean;
  isBulk?: boolean;
  receivedAt: Date;
};

export type RecordResult = { messageId: string; created: boolean };

/**
 * Cuts `text` to at most `limit` characters without splitting a surrogate pair. Reports whether
 * anything was removed.
 */
export function truncate(text: string, limit: number): { text: string; truncated: boolean } {
  if (text.length <= limit) {
    return { text, truncated: false };
  }

  const last = text.charCodeAt(limit - 1);
  const end = last >= 0xd800 && last <= 0xdbff ? limit - 1 : limit;

  return { text: text.slice(0, end), truncated: true };
}

/**
 * Records an email and publishes it to `email.received`. The record is unique on the user, the
 * channel, the provider and the provider's message id, so a message that is delivered twice is
 * recorded once. The message is published when the record is new, and again while the stored status
 * is still `received`, which repairs a publish that was lost after the row was written. The id of
 * the record is the idempotency key of the queue message. A failed publish throws, and recording
 * the same email again publishes it.
 *
 * The gate deletes a `received` record that no playbook handles (decision 0064), so the existing
 * row can disappear between the insert that conflicts with it and the read that follows. The email
 * is then recorded again once, as a new record.
 */
export async function recordInboundEmail(
  deps: { db: Db; queue: Pick<QueueClient, "publish"> },
  email: InboundEmail,
): Promise<RecordResult> {
  return (await tryRecord(deps, email)) ?? (await tryRecord(deps, email)) ?? failRecord();
}

function failRecord(): never {
  throw new Error("The message could not be recorded");
}

/**
 * Inserts the record or reads the existing one. Returns null when the existing record was deleted
 * between the two statements.
 */
async function tryRecord(
  { db, queue }: { db: Db; queue: Pick<QueueClient, "publish"> },
  email: InboundEmail,
): Promise<RecordResult | null> {
  const body = truncate(email.body, MESSAGE_BODY_LIMIT);

  const [inserted] = await db
    .insert(messages)
    .values({
      userId: email.userId,
      channelAccountId: email.channelAccountId,
      channel: email.channel,
      provider: email.provider,
      providerMessageId: email.providerMessageId,
      providerThreadId: email.providerThreadId ?? null,
      fromAddress: email.from,
      toAddresses: [...email.to],
      ccAddresses: [...(email.cc ?? [])],
      subject: truncate(email.subject, MESSAGE_SUBJECT_LIMIT).text,
      body: body.text,
      bodyTruncated: body.truncated,
      isReply: email.isReply ?? false,
      isBulk: email.isBulk ?? false,
      receivedAt: email.receivedAt,
    })
    .onConflictDoNothing()
    .returning({ id: messages.id });

  if (inserted) {
    await publishReceived(queue, inserted.id);

    return { messageId: inserted.id, created: true };
  }

  const [existing] = await db
    .select({ id: messages.id, status: messages.status })
    .from(messages)
    .where(
      and(
        eq(messages.userId, email.userId),
        eq(messages.channel, email.channel),
        eq(messages.provider, email.provider),
        eq(messages.providerMessageId, email.providerMessageId),
      ),
    );

  if (!existing) {
    return null;
  }

  if (existing.status === "received") {
    await publishReceived(queue, existing.id);
  }

  return { messageId: existing.id, created: false };
}

async function publishReceived(queue: Pick<QueueClient, "publish">, messageId: string) {
  const payload: EmailReceivedMessage = { messageId };

  await queue.publish(EMAIL_RECEIVED_QUEUE, payload, { idempotencyKey: messageId });
}
