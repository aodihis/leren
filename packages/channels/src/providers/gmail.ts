import { z } from "zod";

import { deliveryRequest } from "./delivery-request";
import { headerMap, htmlToText, parseAddresses, readMailFlags } from "./mail-format";
import type {
  DeliveryReceipt,
  FetchedEmail,
  FetchResult,
  OutboundReply,
  ReplyContext,
} from "./types";

const API_URL = "https://gmail.googleapis.com/gmail/v1/users/me";

/** Labels of mail that the account itself wrote, which the listener never ingests. */
const OWN_MAIL_LABELS = ["SENT", "DRAFT"];

const profileSchema = z.object({ historyId: z.string().min(1) });

const historySchema = z.object({
  history: z
    .array(
      z.object({
        messagesAdded: z
          .array(
            z.object({
              message: z.object({ id: z.string(), labelIds: z.array(z.string()).optional() }),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
  nextPageToken: z.string().optional(),
  historyId: z.string().min(1),
});

type Part = {
  mimeType?: string | undefined;
  headers?: { name: string; value: string }[] | undefined;
  body?: { data?: string | undefined } | undefined;
  parts?: Part[] | undefined;
};

const partSchema: z.ZodType<Part> = z.lazy(() =>
  z.object({
    mimeType: z.string().optional(),
    headers: z.array(z.object({ name: z.string(), value: z.string() })).optional(),
    body: z.object({ data: z.string().optional() }).optional(),
    parts: z.array(partSchema).optional(),
  }),
);

const messageSchema = z.object({
  id: z.string(),
  threadId: z.string().optional(),
  internalDate: z.string().regex(/^\d+$/),
  payload: partSchema,
});

type GmailMessage = z.infer<typeof messageSchema>;

/** Thrown when Gmail answers a request with a status that is not a success. */
class GmailRequestError extends Error {
  constructor(
    readonly status: number,
    path: string,
  ) {
    super(`Gmail request ${path} failed with status ${status}`);
    this.name = "GmailRequestError";
  }
}

function isNotFound(error: unknown): boolean {
  return error instanceof GmailRequestError && error.status === 404;
}

function decodeBase64Url(data: string): string {
  return Buffer.from(data, "base64url").toString("utf8");
}

function findPart(part: Part, mimeType: string): string | undefined {
  if (part.mimeType === mimeType && part.body?.data) {
    return decodeBase64Url(part.body.data);
  }

  for (const child of part.parts ?? []) {
    const found = findPart(child, mimeType);

    if (found !== undefined) {
      return found;
    }
  }

  return undefined;
}

/** Returns the `text/plain` body, or the text of the `text/html` body when there is none. */
function extractBody(payload: Part): string {
  const plain = findPart(payload, "text/plain");

  if (plain !== undefined) {
    return plain;
  }

  const html = findPart(payload, "text/html");

  return html === undefined ? "" : htmlToText(html);
}

/**
 * Converts a Gmail message to an email. A message is a reply when it names the message it answers,
 * and it is bulk when its headers say it was sent to a list or by a program.
 */
export function parseGmailMessage(message: GmailMessage): FetchedEmail {
  const headers = headerMap(message.payload.headers ?? []);

  return {
    providerMessageId: message.id,
    providerThreadId: message.threadId ?? null,
    from: parseAddresses(headers.get("from"))[0] ?? "",
    to: parseAddresses(headers.get("to")),
    cc: parseAddresses(headers.get("cc")),
    subject: headers.get("subject") ?? "",
    body: extractBody(message.payload),
    ...readMailFlags(headers),
    receivedAt: new Date(Number(message.internalDate)),
  };
}

async function requestGmail(
  send: typeof fetch,
  accessToken: string,
  path: string,
): Promise<unknown> {
  const response = await send(`${API_URL}${path}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new GmailRequestError(response.status, path.split("?")[0] ?? path);
  }

  return response.json();
}

/** Returns the current position of the mailbox, which is the `historyId` of its profile. */
export async function readGmailPosition(send: typeof fetch, accessToken: string): Promise<string> {
  return profileSchema.parse(await requestGmail(send, accessToken, "/profile")).historyId;
}

/**
 * Reads new mail from a Gmail mailbox through the history API, with a `historyId` as the cursor
 * (decision 0041). Without a usable cursor, it returns the current `historyId` and no emails. Mail
 * the account wrote and deleted messages are skipped, and malformed messages are reported in
 * `unreadable`.
 */
export async function fetchNewGmail(
  send: typeof fetch,
  accessToken: string,
  cursor: string | null,
): Promise<FetchResult> {
  const request = (path: string) => requestGmail(send, accessToken, path);

  const baseline = async (): Promise<FetchResult> => ({
    emails: [],
    cursor: await readGmailPosition(send, accessToken),
    baseline: true,
    unreadable: [],
  });

  if (cursor === null) {
    return baseline();
  }

  const ids = new Set<string>();
  let latest = cursor;
  let pageToken: string | undefined;

  do {
    const query = new URLSearchParams({
      startHistoryId: cursor,
      historyTypes: "messageAdded",
      labelId: "INBOX",
    });

    if (pageToken) {
      query.set("pageToken", pageToken);
    }

    let page: z.infer<typeof historySchema>;

    try {
      page = historySchema.parse(await request(`/history?${query.toString()}`));
    } catch (error) {
      if (isNotFound(error)) {
        return baseline();
      }

      throw error;
    }

    for (const entry of page.history ?? []) {
      for (const added of entry.messagesAdded ?? []) {
        const labels = added.message.labelIds ?? [];

        if (!OWN_MAIL_LABELS.some((label) => labels.includes(label))) {
          ids.add(added.message.id);
        }
      }
    }

    latest = page.historyId;
    pageToken = page.nextPageToken;
  } while (pageToken);

  const emails: FetchedEmail[] = [];
  const unreadable: string[] = [];

  for (const id of ids) {
    let raw: unknown;

    try {
      raw = await request(`/messages/${id}?format=full`);
    } catch (error) {
      if (isNotFound(error)) {
        continue;
      }

      throw error;
    }

    const message = messageSchema.safeParse(raw);

    if (message.success) {
      emails.push(parseGmailMessage(message.data));
    } else {
      unreadable.push(id);
    }
  }

  return { emails, cursor: latest, baseline: false, unreadable };
}

const sentSchema = z.object({ id: z.string().min(1) });

const draftSchema = z.object({ id: z.string().min(1) });

const HEADER_VALUE = /^[ -~]*$/;

/** Removes line breaks, so a value can never end a header or start another one. */
function singleLine(value: string): string {
  return value.replaceAll(/[\r\n]+/g, " ").trim();
}

/** Encodes a header value that has characters outside ASCII as an RFC 2047 encoded word. */
function encodeHeader(value: string): string {
  const line = singleLine(value);

  return HEADER_VALUE.test(line) ? line : `=?UTF-8?B?${Buffer.from(line).toString("base64")}?=`;
}

/**
 * Builds the plain text message of a reply as RFC 2822 text, encoded as base64url, which is the
 * form that Gmail takes. The body is sent as base64 so that no line of it can be mistaken for a
 * header.
 */
export function buildRawReply(reply: OutboundReply): string {
  const headers = [
    `To: ${singleLine(reply.to)}`,
    `Subject: ${encodeHeader(reply.subject)}`,
    `Message-ID: ${singleLine(reply.messageId)}`,
    ...(reply.inReplyTo ? [`In-Reply-To: ${singleLine(reply.inReplyTo)}`] : []),
    ...(reply.references ? [`References: ${singleLine(reply.references)}`] : []),
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
  ];

  const body = (
    Buffer.from(reply.body)
      .toString("base64")
      .match(/.{1,76}/g) ?? []
  ).join("\r\n");

  return Buffer.from(`${headers.join("\r\n")}\r\n\r\n${body}\r\n`).toString("base64url");
}

/**
 * Reads the headers of an original message that a reply needs, which are its `Message-ID`, its
 * `References` and its `Reply-To`.
 */
export async function readGmailReplyContext(
  send: typeof fetch,
  accessToken: string,
  providerMessageId: string,
): Promise<ReplyContext> {
  const query = new URLSearchParams([
    ["format", "metadata"],
    ["metadataHeaders", "Message-ID"],
    ["metadataHeaders", "References"],
    ["metadataHeaders", "Reply-To"],
  ]);

  const message = z
    .object({ payload: partSchema })
    .parse(
      await requestGmail(
        send,
        accessToken,
        `/messages/${encodeURIComponent(providerMessageId)}?${query.toString()}`,
      ),
    );

  const headers = headerMap(message.payload.headers ?? []);

  return {
    messageId: headers.get("message-id")?.trim() ?? null,
    references: headers.get("references")?.trim() ?? null,
    replyTo: parseAddresses(headers.get("reply-to"))[0] ?? null,
  };
}

const rateLimitErrorSchema = z.object({
  error: z.object({
    errors: z.array(z.object({ reason: z.string() })).optional(),
    status: z.string().optional(),
  }),
});

const RATE_LIMIT_REASONS = new Set(["rateLimitExceeded", "userRateLimitExceeded"]);

/** Whether a Gmail error body says that a rate limit was reached, which a later retry may pass. */
function isRateLimit(body: unknown): boolean {
  const parsed = rateLimitErrorSchema.safeParse(body);

  return (
    parsed.success &&
    (parsed.data.error.status === "RESOURCE_EXHAUSTED" ||
      (parsed.data.error.errors ?? []).some((entry) => RATE_LIMIT_REASONS.has(entry.reason)))
  );
}

async function postGmail(
  send: typeof fetch,
  accessToken: string,
  path: string,
  body: unknown,
): Promise<unknown> {
  const response = await deliveryRequest(
    send,
    `${API_URL}${path}`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    { service: "Gmail", label: path, isRateLimit },
  );

  return response.json();
}

/** Creates a draft in the mailbox and returns its id with the whole answer of Gmail. */
export async function createGmailDraft(
  send: typeof fetch,
  accessToken: string,
  reply: OutboundReply,
): Promise<DeliveryReceipt> {
  const response = await postGmail(send, accessToken, "/drafts", {
    message: { raw: buildRawReply(reply), threadId: reply.threadId ?? undefined },
  });

  return { id: draftSchema.parse(response).id, response };
}

/** Sends the reply and returns the id of the sent message with the whole answer of Gmail. */
export async function sendGmailReply(
  send: typeof fetch,
  accessToken: string,
  reply: OutboundReply,
): Promise<DeliveryReceipt> {
  const response = await postGmail(send, accessToken, "/messages/send", {
    raw: buildRawReply(reply),
    threadId: reply.threadId ?? undefined,
  });

  return { id: sentSchema.parse(response).id, response };
}
