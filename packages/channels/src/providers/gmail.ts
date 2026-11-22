import { z } from "zod";

import type { FetchedEmail, FetchResult } from "./types";

const API_URL = "https://gmail.googleapis.com/gmail/v1/users/me";

/** Labels of mail that the account itself wrote, which the listener never ingests. */
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

/** Converts HTML to plain text by dropping scripts and styles, breaking lines and removing tags. */
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
 * Returns one address for each mailbox in a header such as `Ana <ana@example.com>, bo@example.com`.
 * A mailbox is split from the next at a comma that is outside a quoted display name. Its address is
 * the one in angle brackets when it has one, and the bare address otherwise, so an address written
 * inside a display name is never taken for the address of the mailbox.
 */
function parseAddresses(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return (value.match(/(?:"(?:[^"\\]|\\.)*"|[^,"])+/g) ?? []).flatMap((mailbox) => {
    const address =
      /<([^<>\s]+@[^<>\s]+)>/.exec(mailbox)?.[1] ?? /[^\s<>"]+@[^\s<>"]+/.exec(mailbox)?.[0];

    return address ? [address.toLowerCase()] : [];
  });
}

/**
 * Converts a Gmail message to an email. A message is a reply when it names the message it answers,
 * and it is bulk when its headers say it was sent to a list or by a program.
 */
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

/** Returns the current position of the mailbox, which is the `historyId` of its profile. */
export async function readGmailPosition(send: typeof fetch, accessToken: string): Promise<string> {
  return profileSchema.parse(await requestGmail(send, accessToken, "/profile")).historyId;
}

/**
 * Reads new mail from a Gmail mailbox with the history API (decision 0041). The cursor is a
 * `historyId`. Without one, or when Gmail no longer holds the history from it, the result is the
 * current `historyId` and no emails. Every page of the history is read, mail that the account
 * itself wrote is left out, a message that was deleted after it arrived is skipped, and a message
 * that does not have the expected shape is reported in `unreadable`.
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
