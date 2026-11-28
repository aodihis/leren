import { simpleParser } from "mailparser";
import type { ParsedMail } from "mailparser";
import MailComposer from "nodemailer/lib/mail-composer";
import { z } from "zod";

import { smtpReplyClass } from "./imap-servers";
import type { ImapClient, MailServers, SmtpSession } from "./imap-servers";
import type { ImapSettings } from "./imap-settings";
import { headerMap, htmlToText, parseAddresses, readMailFlags } from "./mail-format";
import {
  DeliveryNotSentError,
  DeliveryRejectedError,
  InvalidGrantError,
  SignInError,
} from "./types";
import type {
  DeliveryReceipt,
  FetchedEmail,
  FetchResult,
  OutboundReply,
  ReplyContext,
} from "./types";

/** The most UIDs that one poll reads, so a poll of a large backlog stays short (decision 0063). */
export const MAX_UIDS_PER_POLL = 100;

const INBOX = "INBOX";

const cursorSchema = z.object({ uidValidity: z.string().min(1), uid: z.number().int().min(0) });

type Position = z.infer<typeof cursorSchema>;

function parseCursor(cursor: string | null): Position | null {
  if (cursor === null) {
    return null;
  }

  try {
    return cursorSchema.parse(JSON.parse(cursor));
  } catch {
    return null;
  }
}

/**
 * The identity of a mailbox: its IMAP host and user name, in lower case and joined by a slash. It is
 * also the provider's identifier of the account, so connecting the same mailbox again gives it the
 * same identity.
 */
export function mailboxIdentity(settings: ImapSettings): string {
  return `${settings.imapHost}/${settings.username}`.toLowerCase();
}

/**
 * Builds the provider message id from the mailbox identity, the inbox's `UIDVALIDITY` and the UID
 * (decision 0063). A UID is unique only within one inbox, and stored messages are not keyed by
 * account, so the mailbox identity keeps the ids of a user's mailboxes apart.
 */
function encodeMessageId(mailbox: string, uidValidity: string, uid: number): string {
  return `${mailbox}:${uidValidity}:${uid}`;
}

/**
 * Reads the `UIDVALIDITY` and the UID from the end of a provider message id, so a user name that
 * contains a colon does not change them.
 */
function decodeMessageId(providerMessageId: string): Position {
  const [uid = "", uidValidity = ""] = providerMessageId.split(":").toReversed();

  return cursorSchema.parse({ uidValidity, uid: Number(uid) });
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Reports a failure of a delivery that happened before the reply was handed over. */
function notSent(error: unknown): DeliveryNotSentError {
  return new DeliveryNotSentError(`The mail session failed before delivery: ${describe(error)}`);
}

/**
 * Runs a step that signs in or prepares a session, before anything is handed over. A refused
 * password throws `InvalidGrantError`, so the account becomes `revoked`. Any other failure is
 * thrown as `otherwise` maps it.
 */
async function beforeHandover<T>(
  step: () => Promise<T>,
  otherwise: (error: unknown) => unknown = (error) => error,
): Promise<T> {
  try {
    return await step();
  } catch (error) {
    if (error instanceof SignInError && error.reason === "authentication_failed") {
      throw new InvalidGrantError("The mail server refused the password");
    }

    throw otherwise(error);
  }
}

/** Runs `work` with a signed-in session and signs out afterwards, whatever its outcome. */
export async function withClient<T>(client: ImapClient, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } finally {
    await client.logout().catch(() => undefined);
  }
}

/** Returns the position after the newest message of the inbox that `client` has open. */
function currentPosition(mailbox: { uidValidity: bigint; uidNext: number }): Position {
  return { uidValidity: mailbox.uidValidity.toString(), uid: Math.max(mailbox.uidNext - 1, 0) };
}

/** Reads the position of the inbox, which connecting stores so only later mail is read. */
export async function readImapPosition(client: ImapClient): Promise<string> {
  return JSON.stringify(currentPosition(await client.mailboxOpen(INBOX, { readOnly: true })));
}

/**
 * The headers of a parsed message, keyed by lower-case name as `readMailFlags` reads them. A
 * header that is folded over several lines is joined into one line.
 */
function headersOf(parsed: ParsedMail): Map<string, string> {
  return headerMap(
    parsed.headerLines.map((line) => ({
      name: line.key,
      value: line.line
        .slice(line.line.indexOf(":") + 1)
        .replace(/\r?\n[ \t]+/g, " ")
        .trim(),
    })),
  );
}

/** Converts the raw source of one message to an email with the provider message id `id`. */
async function toEmail(
  id: string,
  source: Buffer,
  internalDate: Date | string | undefined,
): Promise<FetchedEmail> {
  const parsed = await simpleParser(source, { skipImageLinks: true, skipTextToHtml: true });
  const headers = headersOf(parsed);
  const receivedAt = internalDate ? new Date(internalDate) : (parsed.date ?? new Date());

  return {
    providerMessageId: id,
    providerThreadId: null,
    from: parseAddresses(headers.get("from"))[0] ?? "",
    to: parseAddresses(headers.get("to")),
    cc: parseAddresses(headers.get("cc")),
    subject: parsed.subject ?? "",
    body: parsed.text?.trim() || htmlToText(typeof parsed.html === "string" ? parsed.html : ""),
    ...readMailFlags(headers),
    receivedAt,
  };
}

/**
 * Reads new mail from an IMAP inbox (decision 0063), opened read-only so that no message is marked
 * `\Seen`. A poll reads at most `MAX_UIDS_PER_POLL` UIDs after the cursor, oldest first, and
 * advances the cursor past them. A changed `UIDVALIDITY` returns a baseline. Unparseable messages
 * are reported in `unreadable`.
 */
export async function fetchNewImapMail(
  servers: MailServers,
  settings: ImapSettings,
  cursor: string | null,
): Promise<FetchResult> {
  const client = await beforeHandover(() => servers.openImap(settings));

  return withClient(client, async () => {
    const current = currentPosition(await client.mailboxOpen(INBOX, { readOnly: true }));
    const position = parseCursor(cursor);

    if (!position || position.uidValidity !== current.uidValidity) {
      return { emails: [], cursor: JSON.stringify(current), baseline: true, unreadable: [] };
    }

    if (current.uid <= position.uid) {
      return { emails: [], cursor: JSON.stringify(position), baseline: false, unreadable: [] };
    }

    const last = Math.min(position.uid + MAX_UIDS_PER_POLL, current.uid);
    const mailbox = mailboxIdentity(settings);
    const emails: { uid: number; email: FetchedEmail }[] = [];
    const unreadable: string[] = [];

    for await (const message of client.fetch(
      `${position.uid + 1}:${last}`,
      { uid: true, source: true, internalDate: true },
      { uid: true },
    )) {
      const id = encodeMessageId(mailbox, current.uidValidity, message.uid);

      try {
        if (!message.source) {
          throw new Error("The message has no source");
        }

        emails.push({
          uid: message.uid,
          email: await toEmail(id, message.source, message.internalDate),
        });
      } catch {
        unreadable.push(id);
      }
    }

    return {
      emails: emails.toSorted((a, b) => a.uid - b.uid).map((entry) => entry.email),
      cursor: JSON.stringify({ uidValidity: current.uidValidity, uid: last }),
      baseline: false,
      unreadable,
    };
  });
}

/**
 * Reads the headers of the original that a reply needs. The original is found by its UID, so it
 * must still be in the inbox, and the inbox must not have been renumbered.
 */
export async function readImapReplyContext(
  servers: MailServers,
  settings: ImapSettings,
  providerMessageId: string,
): Promise<ReplyContext> {
  const original = decodeMessageId(providerMessageId);
  const client = await beforeHandover(() => servers.openImap(settings), notSent);

  return withClient(client, async () => {
    const mailbox = await client.mailboxOpen(INBOX, { readOnly: true });

    if (mailbox.uidValidity.toString() !== original.uidValidity) {
      throw new Error("The inbox was renumbered, so the original cannot be found");
    }

    const message = await client.fetchOne(
      String(original.uid),
      { uid: true, headers: ["message-id", "references", "reply-to"] },
      { uid: true },
    );

    if (!message || !message.headers) {
      throw new Error("The original is no longer in the inbox");
    }

    const headers = headersOf(await simpleParser(message.headers));

    return {
      messageId: headers.get("message-id") ?? null,
      references: headers.get("references") ?? null,
      replyTo: parseAddresses(headers.get("reply-to"))[0] ?? null,
    };
  });
}

/** Builds the raw reply, with the `Message-ID` that the deliverer chose. */
async function composeReply(settings: ImapSettings, reply: OutboundReply): Promise<Buffer> {
  return new MailComposer({
    from: settings.address,
    to: reply.to,
    subject: reply.subject,
    text: reply.body,
    messageId: reply.messageId,
    inReplyTo: reply.inReplyTo ?? undefined,
    references: reply.references ?? undefined,
    date: new Date(),
  })
    .compile()
    .build();
}

/**
 * Finds the mailbox with a special use, such as `\Drafts`, or else one with a common name for it.
 * Returns null when the account has neither.
 */
async function findMailbox(
  client: ImapClient,
  specialUse: "\\Drafts" | "\\Sent",
  names: readonly string[],
): Promise<string | null> {
  const mailboxes = await client.list();
  const wanted = names.map((name) => name.toLowerCase());

  return (
    mailboxes.find((mailbox) => mailbox.specialUse === specialUse)?.path ??
    mailboxes.find((mailbox) => wanted.includes(mailbox.path.toLowerCase()))?.path ??
    null
  );
}

/** Whether the server answered a command with `NO` or `BAD`, which means it refused it. */
function isRefusal(error: unknown): boolean {
  const status = (error as { responseStatus?: unknown } | null)?.responseStatus;

  return status === "NO" || status === "BAD";
}

/**
 * Saves the reply as a draft in the account's Drafts mailbox (decision 0063). The draft carries
 * `In-Reply-To` and `References`, so mail programs show it in the conversation. A server that
 * refuses the append rejects the delivery. A connection that fails during the append leaves the
 * outcome unknown.
 */
export async function createImapDraft(
  servers: MailServers,
  settings: ImapSettings,
  reply: OutboundReply,
): Promise<DeliveryReceipt> {
  const message = await composeReply(settings, reply);
  const client = await beforeHandover(() => servers.openImap(settings), notSent);

  return withClient(client, async () => {
    const drafts = await beforeHandover(
      () => findMailbox(client, "\\Drafts", ["Drafts", "INBOX.Drafts"]),
      notSent,
    );

    if (!drafts) {
      throw new DeliveryRejectedError("rejected", "The account has no Drafts mailbox");
    }

    try {
      const appended = await client.append(drafts, message, ["\\Draft", "\\Seen"]);

      return {
        id: reply.messageId,
        response: { mailbox: drafts, uid: (appended && appended.uid) ?? null },
      };
    } catch (error) {
      if (isRefusal(error)) {
        throw new DeliveryRejectedError("rejected", "The IMAP server refused the draft");
      }

      throw error;
    }
  });
}

/**
 * Hands the reply to SMTP. A `4xx` reply code is a temporary refusal, so nothing was sent, and a
 * `5xx` code is a refusal that a retry cannot fix. Any other failure may have happened after the
 * handover, so its outcome is unknown.
 */
async function submit(
  session: SmtpSession,
  settings: ImapSettings,
  reply: OutboundReply,
  message: Buffer,
): Promise<string> {
  try {
    return await session.send({ from: settings.address, to: [reply.to] }, message);
  } catch (error) {
    const replyClass = smtpReplyClass(error);

    if (replyClass === "temporary") {
      throw new DeliveryNotSentError(`The SMTP server refused the reply: ${describe(error)}`);
    }

    if (replyClass === "permanent") {
      throw new DeliveryRejectedError(
        "rejected",
        `The SMTP server refused the reply: ${describe(error)}`,
      );
    }

    throw error;
  } finally {
    session.quit();
  }
}

/**
 * Saves a copy of a sent reply in the account's Sent mailbox and reports what happened. The reply
 * was already sent, so a failure here never changes the outcome of the delivery.
 */
async function saveSentCopy(
  servers: MailServers,
  settings: ImapSettings,
  message: Buffer,
): Promise<string> {
  try {
    const client = await servers.openImap(settings);

    return await withClient(client, async () => {
      const sent = await findMailbox(client, "\\Sent", ["Sent", "INBOX.Sent"]);

      if (!sent) {
        return "no Sent mailbox";
      }

      await client.append(sent, message, ["\\Seen"]);

      return `saved in ${sent}`;
    });
  } catch (error) {
    return `failed: ${describe(error)}`;
  }
}

/**
 * Sends the reply over SMTP and saves a copy in the Sent mailbox (decision 0063). The id of the
 * receipt is the reply's `Message-ID`. The response records the server's answer and what happened
 * to the copy.
 */
export async function sendImapReply(
  servers: MailServers,
  settings: ImapSettings,
  reply: OutboundReply,
): Promise<DeliveryReceipt> {
  const message = await composeReply(settings, reply);
  const session = await beforeHandover(() => servers.openSmtp(settings), notSent);
  const accepted = await submit(session, settings, reply, message);
  const sentCopy = await saveSentCopy(servers, settings, message);

  return { id: reply.messageId, response: { smtp: accepted, sentCopy } };
}
