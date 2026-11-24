import { z } from "zod";

import { DeliveryNotSentError, DeliveryRejectedError } from "./types";
import type {
  DeliveryReceipt,
  FetchedEmail,
  FetchResult,
  OutboundReply,
  ReplyContext,
} from "./types";

const API_URL = "https://gmail.googleapis.com/gmail/v1/users/me";

/** Labels of mail that the account wrote itself. */
const OWN_MAIL_LABELS = ["SENT", "DRAFT"];

const AUTOMATIC_PRECEDENCE = new Set(["bulk", "list", "junk"]);

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

/** Thrown when Gmail answers with an error status. */
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

/** Converts HTML to plain text. */
function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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

/** Returns the plain or HTML body text. */
function extractBody(payload: Part): string {
  const plain = findPart(payload, "text/plain");

  if (plain !== undefined) {
    return plain;
  }

  const html = findPart(payload, "text/html");

  return html === undefined ? "" : htmlToText(html);
}

/** Returns one address for each mailbox in a header. */
function parseAddresses(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return (value.match(/(?:"(?:[^"\\]|\\.)*"|[^,"])+/g) ?? []).flatMap((mailbox) => {
    const unquoted = mailbox.replace(/"(?:[^"\\]|\\.)*"/g, "");

    const address =
      /<([^<>\s]+@[^<>\s]+)>/.exec(unquoted)?.[1] ?? /[^\s<>"]+@[^\s<>"]+/.exec(unquoted)?.[0];

    return address ? [address.toLowerCase()] : [];
  });
}

/** Converts a Gmail message to an email. */
export function parseGmailMessage(message: GmailMessage): FetchedEmail {
  const headers = new Map(
    (message.payload.headers ?? []).map((header) => [header.name.toLowerCase(), header.value]),
  );

  const autoSubmitted = headers.get("auto-submitted")?.trim().toLowerCase();

  return {
    providerMessageId: message.id,
    providerThreadId: message.threadId ?? null,
    from: parseAddresses(headers.get("from"))[0] ?? "",
    to: parseAddresses(headers.get("to")),
    cc: parseAddresses(headers.get("cc")),
    subject: headers.get("subject") ?? "",
    body: extractBody(message.payload),
    isReply: headers.has("in-reply-to") || headers.has("references"),
    isBulk:
      headers.has("list-unsubscribe") ||
      AUTOMATIC_PRECEDENCE.has(headers.get("precedence")?.trim().toLowerCase() ?? "") ||
      (autoSubmitted !== undefined && autoSubmitted !== "no"),
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

/** Returns the current position of the mailbox. */
export async function readGmailPosition(send: typeof fetch, accessToken: string): Promise<string> {
  return profileSchema.parse(await requestGmail(send, accessToken, "/profile")).historyId;
}

/** Reads new mail with the Gmail history API. */
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

const NOT_REACHED_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"]);

const HEADER_VALUE = /^[ -~]*$/;

/** Removes line breaks from a header value. */
function singleLine(value: string): string {
  return value.replaceAll(/[\r\n]+/g, " ").trim();
}

/** Encodes a non-ASCII header value. */
function encodeHeader(value: string): string {
  const line = singleLine(value);

  return HEADER_VALUE.test(line) ? line : `=?UTF-8?B?${Buffer.from(line).toString("base64")}?=`;
}

/** Builds the base64url RFC 2822 text of a reply. */
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

/** Reads the headers a reply needs. */
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

  const headers = new Map(
    (message.payload.headers ?? []).map((header) => [header.name.toLowerCase(), header.value]),
  );

  return {
    messageId: headers.get("message-id")?.trim() ?? null,
    references: headers.get("references")?.trim() ?? null,
    replyTo: parseAddresses(headers.get("reply-to"))[0] ?? null,
  };
}

/** Reads the network error code of a failed request. */
function networkCode(error: unknown): unknown {
  return error instanceof Error && error.cause instanceof Error
    ? (error.cause as { code?: unknown }).code
    : undefined;
}

const rateLimitErrorSchema = z.object({
  error: z.object({
    errors: z.array(z.object({ reason: z.string() })).optional(),
    status: z.string().optional(),
  }),
});

const RATE_LIMIT_REASONS = new Set(["rateLimitExceeded", "userRateLimitExceeded"]);

/** Whether a Gmail error reports a rate limit. */
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
  let response: Response;

  try {
    response = await send(`${API_URL}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (error) {
    const code = networkCode(error);

    if (typeof code === "string" && NOT_REACHED_CODES.has(code)) {
      throw new DeliveryNotSentError(`Gmail was not reached: ${code}`);
    }

    throw error;
  }

  if (response.ok) {
    return response.json();
  }

  const message = `Gmail request ${path} failed with status ${response.status}`;

  if (response.status === 429 || response.status === 401) {
    throw new DeliveryNotSentError(message);
  }

  if (response.status === 403) {
    const answer: unknown = await response.json().catch(() => undefined);

    throw isRateLimit(answer)
      ? new DeliveryNotSentError(message)
      : new DeliveryRejectedError("forbidden", message);
  }

  if (response.status >= 400 && response.status < 500) {
    throw new DeliveryRejectedError("rejected", message);
  }

  throw new Error(message);
}

/** Creates a draft and returns its id. */
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

/** Sends the reply and returns its id. */
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
