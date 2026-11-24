import {
  DeliveryNotSentError,
  DeliveryRejectedError,
  getAccessToken,
  isEmailSender,
} from "@leren/channels";
import type { ChannelAccountsDependencies, EmailSender, OutboundReply } from "@leren/channels";
import { channelAccounts, messages, replyDecisions } from "@leren/db";
import type { Db } from "@leren/db";
import { transitionMessage } from "@leren/inbox";
import type { EmailDeliverMessage } from "@leren/inbox";
import { and, eq, inArray, sql } from "drizzle-orm";

export type ReplyDeliverDependencies = {
  db: Db;
  channels: ChannelAccountsDependencies;
};

/** The outcome of a delivery run. */
export type ReplyDeliverOutcome = "delivered" | "refused" | "rejected" | "unknown" | "ignored";

/** The stored reason for bulk or own-account mail. */
export const DELIVERY_REFUSED = "delivery_refused";

/** The stored reason for an undeliverable account. */
export const DELIVERY_UNAVAILABLE = "delivery_unavailable";

/** The stored reason for an unfinished delivery. */
export const DELIVERY_ERROR = "delivery_error";

/** The stored reason for an unknown delivery outcome. */
export const DELIVERY_UNKNOWN = "delivery_unknown";

/** The Message-ID domain of delivered replies. */
const MESSAGE_ID_DOMAIN = "leren.local";

/** The longest stored delivery error, in characters. */
const ERROR_LENGTH = 500;

type DeliveryRecord = {
  message: typeof messages.$inferSelect;
  decision: typeof replyDecisions.$inferSelect;
};

/** Appends the original id to the References header. */
function joinReferences(references: string | null, messageId: string | null): string | null {
  const listed = references?.split(/\s+/) ?? [];
  const ids = [references, messageId && !listed.includes(messageId) ? messageId : null];

  return ids.filter(Boolean).join(" ") || null;
}

function domainOf(address: string): string {
  return address.slice(address.lastIndexOf("@") + 1).toLowerCase();
}

/** The address that a reply goes to. */
function recipientOf(from: string, replyTo: string | null): string {
  return replyTo && domainOf(replyTo) === domainOf(from) ? replyTo : from;
}

function withReplyPrefix(subject: string): string {
  return /^re:/i.test(subject.trim()) ? subject.trim() : `Re: ${subject.trim()}`;
}

/** Ends a pending or started delivery as failed. */
export async function failDelivery(
  db: Db,
  messageId: string,
  reason: string,
  error: string = reason,
): Promise<boolean> {
  const finished = await db
    .update(replyDecisions)
    .set({
      deliveryState: "failed",
      deliveryError: (error === reason ? reason : `${reason}: ${error}`).slice(0, ERROR_LENGTH),
      deliveryFinishedAt: new Date(),
    })
    .where(
      and(
        eq(replyDecisions.messageId, messageId),
        inArray(replyDecisions.deliveryState, ["pending", "started"]),
      ),
    )
    .returning({ id: replyDecisions.id });

  if (finished.length === 0) {
    return false;
  }

  await transitionMessage(db, messageId, "failed", reason);

  return true;
}

/** Ends a delivery whose job ran out of attempts. */
export async function failUnfinishedDelivery(
  db: Db,
  messageId: string,
  error: string,
): Promise<boolean> {
  const [row] = await db
    .select({ state: replyDecisions.deliveryState })
    .from(replyDecisions)
    .where(eq(replyDecisions.messageId, messageId));

  return failDelivery(
    db,
    messageId,
    row?.state === "started" ? DELIVERY_UNKNOWN : DELIVERY_ERROR,
    error,
  );
}

async function readRecord(db: Db, messageId: string): Promise<DeliveryRecord | undefined> {
  const [row] = await db
    .select({ message: messages, decision: replyDecisions })
    .from(messages)
    .innerJoin(replyDecisions, eq(replyDecisions.messageId, messages.id))
    .where(eq(messages.id, messageId));

  return row;
}

/** Ends the delivery as failed without a call. */
async function refuse(db: Db, messageId: string, reason: string): Promise<"refused"> {
  await failDelivery(db, messageId, reason);

  return "refused";
}

/** Whether an address belongs to the account. */
function isAddressOf(address: string, accountAddress: string): boolean {
  return address.toLowerCase() === accountAddress.toLowerCase();
}

/** Finishes the move of a sent mail to sent. */
async function finishSent(db: Db, { message, decision }: DeliveryRecord): Promise<boolean> {
  if (decision.deliveryMode !== "send" || decision.deliveryState !== "completed") {
    return false;
  }

  await transitionMessage(db, message.id, "sent");

  return true;
}

/** Delivers the reply of one message. */
export async function deliverReply(
  { db, channels }: ReplyDeliverDependencies,
  payload: EmailDeliverMessage,
): Promise<ReplyDeliverOutcome> {
  const record = await readRecord(db, payload.messageId);

  if (!record || record.message.status !== "drafted") {
    return "ignored";
  }

  const { message, decision } = record;

  if (await finishSent(db, record)) {
    return "delivered";
  }

  if (decision.deliveryState === "failed") {
    await transitionMessage(
      db,
      message.id,
      "failed",
      decision.deliveryError?.split(":")[0] ?? null,
    );

    return "ignored";
  }

  if (decision.deliveryState === "started") {
    await failDelivery(db, message.id, DELIVERY_UNKNOWN);

    return "unknown";
  }

  if (decision.deliveryState !== "pending" || !decision.deliveryMode || !decision.body) {
    return "ignored";
  }

  const [account] = message.channelAccountId
    ? await db
        .select()
        .from(channelAccounts)
        .where(eq(channelAccounts.id, message.channelAccountId))
    : [];

  const provider = account ? channels.providers.get(account.provider) : undefined;

  if (!account || account.userId !== message.userId || !provider || !isEmailSender(provider)) {
    return refuse(db, message.id, DELIVERY_UNAVAILABLE);
  }

  if (message.isBulk || isAddressOf(message.fromAddress, account.label)) {
    return refuse(db, message.id, DELIVERY_REFUSED);
  }

  const accessToken = await getAccessToken(db, channels, account.userId, account.id);

  if (accessToken === null) {
    return refuse(db, message.id, DELIVERY_UNAVAILABLE);
  }

  const context = await provider.readReplyContext(accessToken, message.providerMessageId);
  const recipient = recipientOf(message.fromAddress, context.replyTo);

  if (isAddressOf(recipient, account.label)) {
    return refuse(db, message.id, DELIVERY_REFUSED);
  }

  const reply: OutboundReply = {
    to: recipient,
    subject: withReplyPrefix(message.subject),
    body: decision.body,
    threadId: message.providerThreadId,
    messageId: `<leren-${message.id}@${MESSAGE_ID_DOMAIN}>`,
    inReplyTo: context.messageId,
    references: joinReferences(context.references, context.messageId),
  };

  const started = await db
    .update(replyDecisions)
    .set({
      deliveryState: "started",
      deliveryAttempts: sql`${replyDecisions.deliveryAttempts} + 1`,
      deliveryStartedAt: new Date(),
      deliveryRequest: { mode: decision.deliveryMode, ...reply },
    })
    .where(and(eq(replyDecisions.id, decision.id), eq(replyDecisions.deliveryState, "pending")))
    .returning({ id: replyDecisions.id });

  if (started.length === 0) {
    return "ignored";
  }

  return callProvider(db, provider, accessToken, record, reply);
}

/** Makes the provider call and records its end. */
async function callProvider(
  db: Db,
  provider: EmailSender,
  accessToken: string,
  { message, decision }: DeliveryRecord,
  reply: OutboundReply,
): Promise<ReplyDeliverOutcome> {
  const mode = decision.deliveryMode;

  try {
    const receipt =
      mode === "send"
        ? await provider.sendReply(accessToken, reply)
        : await provider.createDraft(accessToken, reply);

    await db
      .update(replyDecisions)
      .set({
        deliveryResponse: receipt.response,
        deliveryFinishedAt: new Date(),
        ...(mode === "send" ? { sentMessageId: receipt.id } : { mailboxDraftId: receipt.id }),
      })
      .where(eq(replyDecisions.id, decision.id));

    const completed = await db
      .update(replyDecisions)
      .set({ deliveryState: "completed" })
      .where(and(eq(replyDecisions.id, decision.id), eq(replyDecisions.deliveryState, "started")))
      .returning({ id: replyDecisions.id });

    if (mode === "send" && completed.length > 0) {
      await transitionMessage(db, message.id, "sent");
    }

    return "delivered";
  } catch (error) {
    if (error instanceof DeliveryNotSentError) {
      await db
        .update(replyDecisions)
        .set({ deliveryState: "pending" })
        .where(
          and(eq(replyDecisions.id, decision.id), eq(replyDecisions.deliveryState, "started")),
        );

      throw error;
    }

    if (error instanceof DeliveryRejectedError) {
      await failDelivery(db, message.id, error.reason, error.message);

      return "rejected";
    }

    throw error;
  }
}
