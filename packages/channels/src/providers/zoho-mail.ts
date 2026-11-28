import { z } from "zod";

import { deliveryRequest } from "./delivery-request";
import { headerMap, htmlToText, parseAddresses, readMailFlags } from "./mail-format";
import { DeliveryNotSentError } from "./types";
import type {
  DeliveryReceipt,
  FetchedEmail,
  FetchResult,
  OutboundReply,
  ReplyContext,
} from "./types";

/** The number of messages that one request of the inbox lists, which is Zoho's maximum. */
const PAGE_SIZE = 200;

/** The number of pages that one poll reads at most, so a flood of mail cannot stall the poller. */
const MAX_PAGES = 5;

const accountsSchema = z.object({
  data: z.array(
    z.object({
      accountId: z.coerce.string().min(1),
      zuid: z.coerce.string().optional(),
      type: z.string().optional(),
      primaryEmailAddress: z.string().min(1),
    }),
  ),
});

const foldersSchema = z.object({
  data: z.array(
    z.object({
      folderId: z.coerce.string().min(1),
      folderType: z.string().optional(),
      path: z.string().optional(),
    }),
  ),
});

const listedSchema = z.object({
  messageId: z.coerce.string().min(1),
  folderId: z.coerce.string().min(1),
  threadId: z.coerce.string().nullish(),
  receivedTime: z.coerce.number().int(),
  fromAddress: z.string().nullish(),
  subject: z.string().nullish(),
});

type ListedMessage = z.infer<typeof listedSchema>;

const listSchema = z.object({ data: z.array(z.unknown()) });

const headerSchema = z.object({
  data: z.object({ headerContent: z.record(z.string(), z.array(z.string())) }),
});

const contentSchema = z.object({ data: z.object({ content: z.string().nullish() }) });

/**
 * The position of the inbox, built from its list because Zoho has no cursor: the account and
 * folder, the receive time of the newest message seen, and the ids of every message received at
 * that time, because several messages can share it.
 */
const cursorSchema = z.object({
  accountId: z.string().min(1),
  folderId: z.string().min(1),
  after: z.number().int(),
  seen: z.array(z.string()),
});

type ZohoCursor = z.infer<typeof cursorSchema>;

/** The Zoho mailbox that a token gives access to. */
export type ZohoAccount = { accountId: string; zuid: string | null; address: string };

/** Thrown when Zoho answers a request with a status that is not a success. */
class ZohoRequestError extends Error {
  constructor(
    readonly status: number,
    path: string,
  ) {
    super(`Zoho Mail request ${path} failed with status ${status}`);
    this.name = "ZohoRequestError";
  }
}

function isNotFound(error: unknown): boolean {
  return error instanceof ZohoRequestError && error.status === 404;
}

function headers(accessToken: string): Record<string, string> {
  return { authorization: `Zoho-oauthtoken ${accessToken}` };
}

async function getZoho(
  send: typeof fetch,
  apiUrl: string,
  accessToken: string,
  path: string,
): Promise<unknown> {
  const response = await send(`${apiUrl}${path}`, { headers: headers(accessToken) });

  if (!response.ok) {
    throw new ZohoRequestError(response.status, path.split("?")[0] ?? path);
  }

  return response.json();
}

/**
 * Returns the mailbox of the token: the first account of Zoho Mail's own type, which is the
 * user's primary mailbox and not a mailbox of another provider that the user added to Zoho.
 */
export async function readZohoAccount(
  send: typeof fetch,
  apiUrl: string,
  accessToken: string,
): Promise<ZohoAccount> {
  const { data } = accountsSchema.parse(await getZoho(send, apiUrl, accessToken, "/api/accounts"));
  const account = data.find((entry) => entry.type === undefined || entry.type === "ZOHO_ACCOUNT");

  if (!account) {
    throw new Error("Zoho Mail returned no mailbox for the account");
  }

  return {
    accountId: account.accountId,
    zuid: account.zuid ?? null,
    address: account.primaryEmailAddress.trim().toLowerCase(),
  };
}

/** Returns the id of the inbox. A folder that a user created can also have the type `Inbox`. */
async function readInboxId(
  send: typeof fetch,
  apiUrl: string,
  accessToken: string,
  accountId: string,
): Promise<string> {
  const { data } = foldersSchema.parse(
    await getZoho(send, apiUrl, accessToken, `/api/accounts/${accountId}/folders`),
  );

  const inbox =
    data.find((folder) => folder.folderType === "Inbox" && folder.path === "/Inbox") ??
    data.find((folder) => folder.folderType === "Inbox");

  if (!inbox) {
    throw new Error("Zoho Mail returned no inbox for the account");
  }

  return inbox.folderId;
}

/** Lists one page of the inbox, newest first. An entry that has an unexpected shape is left out. */
async function listInbox(
  send: typeof fetch,
  apiUrl: string,
  accessToken: string,
  cursor: Pick<ZohoCursor, "accountId" | "folderId">,
  start: number,
): Promise<{ messages: ListedMessage[]; full: boolean }> {
  const query = new URLSearchParams({
    folderId: cursor.folderId,
    start: String(start),
    limit: String(PAGE_SIZE),
    sortBy: "date",
    sortorder: "false",
  });

  const { data } = listSchema.parse(
    await getZoho(
      send,
      apiUrl,
      accessToken,
      `/api/accounts/${cursor.accountId}/messages/view?${query}`,
    ),
  );

  return {
    messages: data.flatMap((entry) => {
      const parsed = listedSchema.safeParse(entry);

      return parsed.success ? [parsed.data] : [];
    }),
    full: data.length === PAGE_SIZE,
  };
}

/** Builds the position after `messages`, which are listed newest first. */
function positionAfter(base: ZohoCursor, messages: readonly ListedMessage[]): ZohoCursor {
  const newest = messages[0];

  if (!newest || newest.receivedTime < base.after) {
    return base;
  }

  const atNewest = messages.flatMap((message) =>
    message.receivedTime === newest.receivedTime ? [message.messageId] : [],
  );

  return {
    ...base,
    after: newest.receivedTime,
    seen: newest.receivedTime === base.after ? [...new Set([...base.seen, ...atNewest])] : atNewest,
  };
}

/**
 * Returns the current position of the inbox of `accountId`, or of the token's mailbox when it is
 * absent: the newest message in it, or the start of time when the inbox is empty, so that every
 * later message is new.
 */
export async function readZohoPosition(
  send: typeof fetch,
  apiUrl: string,
  accessToken: string,
  knownAccountId?: string,
): Promise<string> {
  const accountId = knownAccountId ?? (await readZohoAccount(send, apiUrl, accessToken)).accountId;

  const folderId = await readInboxId(send, apiUrl, accessToken, accountId);
  const base: ZohoCursor = { accountId, folderId, after: 0, seen: [] };
  const { messages } = await listInbox(send, apiUrl, accessToken, base, 1);

  return JSON.stringify(positionAfter(base, messages));
}

function parseCursor(cursor: string | null): ZohoCursor | null {
  if (cursor === null) {
    return null;
  }

  try {
    return cursorSchema.parse(JSON.parse(cursor));
  } catch {
    return null;
  }
}

/** Encodes the folder and the message id, because reading a message's headers needs both. */
function encodeMessageId(message: Pick<ListedMessage, "folderId" | "messageId">): string {
  return `${message.folderId}:${message.messageId}`;
}

function decodeMessageId(providerMessageId: string): { folderId: string; messageId: string } {
  const [folderId, messageId] = providerMessageId.split(":");

  if (!folderId || !messageId) {
    throw new Error("The provider message id is not a Zoho Mail id");
  }

  return { folderId, messageId };
}

async function readHeaders(
  send: typeof fetch,
  apiUrl: string,
  accessToken: string,
  accountId: string,
  ids: { folderId: string; messageId: string },
): Promise<Map<string, string>> {
  const { data } = headerSchema.parse(
    await getZoho(
      send,
      apiUrl,
      accessToken,
      `/api/accounts/${accountId}/folders/${ids.folderId}/messages/${ids.messageId}/header?raw=false`,
    ),
  );

  return headerMap(
    Object.entries(data.headerContent).flatMap(([name, values]) =>
      values.map((value) => ({ name, value })),
    ),
  );
}

/** Reads one listed message in full and converts it to an email. */
async function readEmail(
  send: typeof fetch,
  apiUrl: string,
  accessToken: string,
  accountId: string,
  listed: ListedMessage,
): Promise<FetchedEmail> {
  const mailHeaders = await readHeaders(send, apiUrl, accessToken, accountId, listed);

  const { data } = contentSchema.parse(
    await getZoho(
      send,
      apiUrl,
      accessToken,
      `/api/accounts/${accountId}/folders/${listed.folderId}/messages/${listed.messageId}/content?includeBlockContent=true`,
    ),
  );

  return {
    providerMessageId: encodeMessageId(listed),
    providerThreadId: listed.threadId ?? null,
    from:
      parseAddresses(mailHeaders.get("from"))[0] ??
      parseAddresses(listed.fromAddress ?? undefined)[0] ??
      "",
    to: parseAddresses(mailHeaders.get("to")),
    cc: parseAddresses(mailHeaders.get("cc")),
    subject: listed.subject ?? "",
    body: htmlToText(data.content ?? ""),
    ...readMailFlags(mailHeaders),
    receivedAt: new Date(listed.receivedTime),
  };
}

/**
 * Reads new mail from a Zoho inbox (decision 0061). Zoho keeps no change history, so the inbox is
 * listed newest first back to the cursor, for at most `MAX_PAGES` pages, and older mail is a gap. A
 * message listed twice is read once, and a deleted one is skipped.
 */
export async function fetchNewZohoMail(
  send: typeof fetch,
  apiUrl: string,
  accessToken: string,
  cursor: string | null,
): Promise<FetchResult> {
  const position = parseCursor(cursor);

  if (!position) {
    return {
      emails: [],
      cursor: await readZohoPosition(send, apiUrl, accessToken),
      baseline: true,
      unreadable: [],
    };
  }

  const fresh = new Map<string, ListedMessage>();
  const seen = new Set(position.seen);
  let reachedPosition = false;

  for (let page = 0; page < MAX_PAGES && !reachedPosition; page += 1) {
    const { messages, full } = await listInbox(
      send,
      apiUrl,
      accessToken,
      position,
      page * PAGE_SIZE + 1,
    );

    for (const message of messages) {
      if (message.receivedTime < position.after) {
        reachedPosition = true;
        break;
      }

      if (
        !fresh.has(message.messageId) &&
        (message.receivedTime > position.after || !seen.has(message.messageId))
      ) {
        fresh.set(message.messageId, message);
      }
    }

    reachedPosition ||= !full;
  }

  const emails: FetchedEmail[] = [];
  const unreadable: string[] = [];

  for (const listed of [...fresh.values()].toReversed()) {
    try {
      emails.push(await readEmail(send, apiUrl, accessToken, position.accountId, listed));
    } catch (error) {
      if (isNotFound(error)) {
        continue;
      }

      if (error instanceof z.ZodError) {
        unreadable.push(encodeMessageId(listed));
        continue;
      }

      throw error;
    }
  }

  return {
    emails,
    cursor: JSON.stringify(positionAfter(position, [...fresh.values()])),
    baseline: false,
    unreadable,
  };
}

/**
 * Reads what a reply needs from the headers of the original: its `Message-ID`, its `References`
 * and its `Reply-To`.
 */
export async function readZohoReplyContext(
  send: typeof fetch,
  apiUrl: string,
  accessToken: string,
  providerMessageId: string,
): Promise<ReplyContext> {
  const { accountId } = await readZohoAccount(send, apiUrl, accessToken);

  const mailHeaders = await readHeaders(
    send,
    apiUrl,
    accessToken,
    accountId,
    decodeMessageId(providerMessageId),
  );

  return {
    messageId: mailHeaders.get("message-id")?.trim() ?? null,
    references: mailHeaders.get("references")?.trim() ?? null,
    replyTo: parseAddresses(mailHeaders.get("reply-to"))[0] ?? null,
  };
}

const sentSchema = z.object({
  data: z.object({ messageId: z.coerce.string().min(1).optional() }).optional(),
});

/**
 * Makes one request of a delivery, with the errors of `deliveryRequest`, and returns the id of the
 * message from Zoho's answer. An answer without the id has an unknown outcome.
 */
async function postZoho(
  send: typeof fetch,
  apiUrl: string,
  accessToken: string,
  path: string,
  body: unknown,
): Promise<DeliveryReceipt> {
  const response = await deliveryRequest(
    send,
    `${apiUrl}${path}`,
    {
      method: "POST",
      headers: { ...headers(accessToken), "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    { service: "Zoho Mail", label: path },
  );

  const answer: unknown = await response.json().catch(() => undefined);
  const id = sentSchema.safeParse(answer).data?.data?.messageId;

  if (!id) {
    throw new Error(`Zoho Mail answered ${path} without the id of the message`);
  }

  return { id, response: answer };
}

/**
 * Reads the account to deliver from. A failure to read it happens before anything is delivered,
 * so it is reported as a delivery that did not happen.
 */
async function deliveryAccount(
  send: typeof fetch,
  apiUrl: string,
  accessToken: string,
): Promise<ZohoAccount> {
  try {
    return await readZohoAccount(send, apiUrl, accessToken);
  } catch (error) {
    throw new DeliveryNotSentError(
      `Reading the Zoho Mail account failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** The fields of a reply that a draft and a sent reply share: a plain-text mail from the account. */
function replyBody(account: ZohoAccount, reply: OutboundReply) {
  return {
    fromAddress: account.address,
    toAddress: reply.to,
    subject: reply.subject,
    content: reply.body,
    mailFormat: "plaintext",
  };
}

/**
 * Saves the reply as a draft in the conversation of the original (decision 0061). The draft names
 * the original in `inReplyTo` and `refHeader`, which is how Zoho threads a draft.
 */
export async function createZohoDraft(
  send: typeof fetch,
  apiUrl: string,
  accessToken: string,
  reply: OutboundReply,
): Promise<DeliveryReceipt> {
  const account = await deliveryAccount(send, apiUrl, accessToken);

  return postZoho(send, apiUrl, accessToken, `/api/accounts/${account.accountId}/messages`, {
    ...replyBody(account, reply),
    mode: "draft",
    inReplyTo: reply.inReplyTo ?? undefined,
    refHeader: reply.references ?? undefined,
  });
}

/** Sends the reply to the original with Zoho's reply action, which threads it (decision 0061). */
export async function sendZohoReply(
  send: typeof fetch,
  apiUrl: string,
  accessToken: string,
  reply: OutboundReply,
): Promise<DeliveryReceipt> {
  const account = await deliveryAccount(send, apiUrl, accessToken);
  const { messageId } = decodeMessageId(reply.providerMessageId);

  return postZoho(
    send,
    apiUrl,
    accessToken,
    `/api/accounts/${account.accountId}/messages/${messageId}`,
    { ...replyBody(account, reply), action: "reply" },
  );
}
