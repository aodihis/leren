import {
  DeliveryNotSentError,
  DeliveryRejectedError,
  getAccessToken,
  isEmailSender,
  revokeOnRefusedCredentials,
} from "@leren/channels";
import type { ChannelAccountsDependencies, EmailSender, OutboundReply } from "@leren/channels";
import { channelAccounts, messages, replyDecisions } from "@leren/db";
import type { Db } from "@leren/db";
import { redactMessageText, transitionMessage } from "@leren/inbox";
import type { EmailDeliverMessage } from "@leren/inbox";
import { and, eq, inArray, sql } from "drizzle-orm";

export type ReplyDeliverDependencies = {
  db: Db;
  channels: ChannelAccountsDependencies;
};

/**
 * What a run did. `delivered` means that the provider answered and the record is complete.
 * `refused` and `rejected` mean that the delivery ended without a call, or with an answer that
 * refuses it, and that the message is `failed`. `unknown` means that an earlier call has no
 * recorded end, so nothing is called again. `ignored` means that there was nothing to deliver.
 */
export type ReplyDeliverOutcome = "delivered" | "refused" | "rejected" | "unknown" | "ignored";

/** The reason that is stored when the original is bulk mail, or comes from the account itself. */
export const DELIVERY_REFUSED = "delivery_refused";

/** The reason that is stored when the account or its provider cannot deliver. */
export const DELIVERY_UNAVAILABLE = "delivery_unavailable";

/** The reason that is stored when a delivery could not be finished. */
export const DELIVERY_ERROR = "delivery_error";

/** The reason that is stored when a delivery has no recorded end, so that its outcome is unknown. */
export const DELIVERY_UNKNOWN = "delivery_unknown";

/** The domain of the `Message-ID` header of every reply that the product delivers. */
const MESSAGE_ID_DOMAIN = "leren.local";

/** The longest error, in characters, that is stored with a failed delivery. */
const ERROR_LENGTH = 500;

type DeliveryRecord = {
  message: typeof messages.$inferSelect;
  decision: typeof replyDecisions.$inferSelect;
};

/** Appends the id of the original to its `References` unless the header already lists it. */
function joinReferences(references: string | null, messageId: string | null): string | null {
  const listed = references?.split(/\s+/) ?? [];
  const ids = [references, messageId && !listed.includes(messageId) ? messageId : null];

  return ids.filter(Boolean).join(" ") || null;
}

function domainOf(address: string): string {
  return address.slice(address.lastIndexOf("@") + 1).toLowerCase();
}

/**
 * The address that a reply goes to: the `Reply-To` address of the original when it is in the domain
 * of the sender, and the sender otherwise, so that the sender of an email cannot make the product
 * send mail to an address of a third party.
 */
function recipientOf(from: string, replyTo: string | null): string {
  return replyTo && domainOf(replyTo) === domainOf(from) ? replyTo : from;
}

function withReplyPrefix(subject: string): string {
  return /^re:/i.test(subject.trim()) ? subject.trim() : `Re: ${subject.trim()}`;
}

/**
 * Ends a delivery that is `pending` or `started` as failed and moves the message to `failed`. The
 * record keeps the request and the times. `reason` is the code of the cause and is the status reason
 * of the message. The stored error is the code alone, or the code, a colon and a description, so the
 * code can always be read back from it. A delivery that has already ended is left alone, and so is
 * its message. Returns whether the record was changed.
 */
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

/**
 * Ends a delivery whose job ran out of attempts. A delivery that is still `started` has a call
 * whose outcome is not known, so it ends as `delivery_unknown`, and any other delivery ends with
 * `delivery_error`. `error` describes the failure of the last attempt.
 */
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

/** Ends the delivery as failed for `reason`, without a call to the provider. */
async function refuse(db: Db, messageId: string, reason: string): Promise<"refused"> {
  await failDelivery(db, messageId, reason);

  return "refused";
}

/**
 * Whether an address is the address of the account. A reply is never sent to the account itself,
 * and a mail from it is never answered, because either could start a loop (decision 0046).
 */
function isAddressOf(address: string, accountAddress: string): boolean {
  return address.toLowerCase() === accountAddress.toLowerCase();
}

/** Finishes the move to `sent` of a mail that was sent and whose record is complete. */
async function finishSent(db: Db, { message, decision }: DeliveryRecord): Promise<boolean> {
  if (decision.deliveryMode !== "send" || decision.deliveryState !== "completed") {
    return false;
  }

  await transitionMessage(db, message.id, "sent");

  return true;
}

/**
 * Delivers the reply of one message as a draft in the mailbox or as a sent mail (decision 0046).
 * The function reads the current records and does nothing unless the message is `drafted` and the
 * delivery is `pending`.
 *
 * Everything that can fail before the call is done first: the credentials, the headers of the
 * original and the checks. Then one conditional update moves the delivery from `pending` to
 * `started` and stores the exact request, so that a delivery that is `started` and has no end is
 * visible. A delivery that is found `started` is never called again: it ends as `delivery_unknown`.
 * A delivery that is known not to have reached the provider goes back to `pending` and is retried.
 */
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

  if (decision.deliveryMode === "draft" && decision.deliveryState === "completed") {
    await redactMessageText(db, message.id);

    return "ignored";
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

  const read = await revokeOnRefusedCredentials(db, account, () =>
    provider.readReplyContext(accessToken, message.providerMessageId),
  );

  if (read.revoked) {
    return refuse(db, message.id, DELIVERY_UNAVAILABLE);
  }

  const context = read.value;

  const recipient = recipientOf(message.fromAddress, context.replyTo);

  if (isAddressOf(recipient, account.label)) {
    return refuse(db, message.id, DELIVERY_REFUSED);
  }

  const reply: OutboundReply = {
    to: recipient,
    subject: withReplyPrefix(message.subject),
    body: decision.body,
    providerMessageId: message.providerMessageId,
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

  return callProvider(db, provider, accessToken, account, record, reply);
}

/**
 * Makes the call and writes its end. A known failure ends the delivery or puts it back to
 * `pending`. Credentials that the mailbox refused make the account `revoked` and end the delivery,
 * because nothing was delivered and nothing can be until the account is connected again. Any other
 * failure is thrown and leaves the delivery `started`, so that it is never called again.
 */
async function callProvider(
  db: Db,
  provider: EmailSender,
  accessToken: string,
  account: Pick<typeof channelAccounts.$inferSelect, "id" | "credentials">,
  { message, decision }: DeliveryRecord,
  reply: OutboundReply,
): Promise<ReplyDeliverOutcome> {
  const mode = decision.deliveryMode;

  try {
    const call = await revokeOnRefusedCredentials(db, account, () =>
      mode === "send"
        ? provider.sendReply(accessToken, reply)
        : provider.createDraft(accessToken, reply),
    );

    if (call.revoked) {
      return await refuse(db, message.id, DELIVERY_UNAVAILABLE);
    }

    const receipt = call.value;

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

    if (completed.length > 0) {
      await (mode === "send"
        ? transitionMessage(db, message.id, "sent")
        : redactMessageText(db, message.id));
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
