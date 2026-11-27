import { z } from "zod";

import { deliveryRequest } from "./delivery-request";
import { headerMap, readMailFlags } from "./mail-format";
import { DeliveryNotSentError, DeliveryRejectedError } from "./types";
import type {
  DeliveryReceipt,
  FetchedEmail,
  FetchResult,
  OutboundReply,
  ReplyContext,
} from "./types";

const API_URL = "https://graph.microsoft.com/v1.0/me";

/**
 * Every request asks for immutable ids, so the id of a message stays the same when it moves between
 * folders (decision 0060). Bodies are asked for as plain text.
 */
const PREFER = 'IdType="ImmutableId", outlook.body-content-type="text"';

const MESSAGE_FIELDS = [
  "id",
  "conversationId",
  "from",
  "toRecipients",
  "ccRecipients",
  "subject",
  "body",
  "receivedDateTime",
  "isDraft",
  "internetMessageHeaders",
].join(",");

const deltaPageSchema = z.object({
  value: z.array(z.object({ id: z.string(), "@removed": z.unknown().optional() })),
  "@odata.nextLink": z.string().optional(),
  "@odata.deltaLink": z.string().optional(),
});

const recipientSchema = z.object({
  emailAddress: z.object({ address: z.string().optional() }).optional(),
});

const headersSchema = z.array(z.object({ name: z.string(), value: z.string() })).optional();

const messageSchema = z.object({
  id: z.string(),
  conversationId: z.string().nullish(),
  from: recipientSchema.nullish(),
  toRecipients: z.array(recipientSchema).nullish(),
  ccRecipients: z.array(recipientSchema).nullish(),
  subject: z.string().nullish(),
  body: z.object({ content: z.string().nullish() }).nullish(),
  receivedDateTime: z.iso.datetime({ offset: true }),
  isDraft: z.boolean().nullish(),
  internetMessageHeaders: headersSchema,
});

type GraphMessage = z.infer<typeof messageSchema>;

const graphErrorSchema = z.object({ error: z.object({ code: z.string() }) });

/**
 * The error codes with which Graph answers a delta link that it can no longer resume from. Graph
 * also answers such a link with status 410 whatever the code.
 */
const EXPIRED_SYNC_CODES = new Set(["syncstatenotfound", "syncstateinvalid", "resyncrequired"]);

/** Thrown when Graph answers a request with a status that is not a success. */
class GraphRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    path: string,
  ) {
    super(`Graph request ${path} failed with status ${status}`);
    this.name = "GraphRequestError";
  }
}

function isNotFound(error: unknown): boolean {
  return error instanceof GraphRequestError && error.status === 404;
}

function isExpiredSync(error: unknown): boolean {
  return (
    error instanceof GraphRequestError &&
    (error.status === 410 || EXPIRED_SYNC_CODES.has(error.code?.toLowerCase() ?? ""))
  );
}

/** Returns the path of a Graph URL without its query, which is safe to put in an error message. */
function pathOf(url: string): string {
  return new URL(url).pathname;
}

async function errorCode(response: Response): Promise<string | undefined> {
  const parsed = graphErrorSchema.safeParse(await response.json().catch(() => undefined));

  return parsed.success ? parsed.data.error.code : undefined;
}

function graphHeaders(accessToken: string): Record<string, string> {
  return { authorization: `Bearer ${accessToken}`, prefer: PREFER };
}

/** Reads a Graph URL, which is either a path under `/me` or a whole link that Graph returned. */
async function getGraph(send: typeof fetch, accessToken: string, url: string): Promise<unknown> {
  const target = url.startsWith("https://") ? url : `${API_URL}${url}`;

  const response = await send(target, { headers: graphHeaders(accessToken) });

  if (!response.ok) {
    throw new GraphRequestError(response.status, await errorCode(response), pathOf(target));
  }

  return response.json();
}

function addressOf(recipient: z.infer<typeof recipientSchema> | null | undefined): string | null {
  const address = recipient?.emailAddress?.address?.trim().toLowerCase();

  return address ? address : null;
}

function addressesOf(recipients: z.infer<typeof recipientSchema>[] | null | undefined): string[] {
  return (recipients ?? []).flatMap((recipient) => addressOf(recipient) ?? []);
}

/**
 * Converts a Graph message to an email. Graph leaves out the internet headers of mail that never
 * left the organisation, and such a message is then neither a reply nor bulk.
 */
export function parseOutlookMessage(message: GraphMessage): FetchedEmail {
  return {
    providerMessageId: message.id,
    providerThreadId: message.conversationId ?? null,
    from: addressOf(message.from) ?? "",
    to: addressesOf(message.toRecipients),
    cc: addressesOf(message.ccRecipients),
    subject: message.subject ?? "",
    body: message.body?.content?.trim() ?? "",
    ...readMailFlags(headerMap(message.internetMessageHeaders ?? [])),
    receivedAt: new Date(message.receivedDateTime),
  };
}

/**
 * Follows a delta from `url` through every page and returns the ids of the messages that it
 * reports, without the ones it reports as removed, together with the delta link to resume from.
 */
async function readDelta(
  send: typeof fetch,
  accessToken: string,
  url: string,
): Promise<{ ids: string[]; deltaLink: string }> {
  const ids: string[] = [];
  let next = url;

  for (;;) {
    const page = deltaPageSchema.parse(await getGraph(send, accessToken, next));

    for (const entry of page.value) {
      if (entry["@removed"] === undefined) {
        ids.push(entry.id);
      }
    }

    if (page["@odata.deltaLink"]) {
      return { ids, deltaLink: page["@odata.deltaLink"] };
    }

    if (!page["@odata.nextLink"]) {
      throw new Error("Graph returned a delta page without a next link or a delta link");
    }

    next = page["@odata.nextLink"];
  }
}

/**
 * Returns the current position of the inbox: a delta link that reports only messages received from
 * `now` on. The filter stays in the link, so a later change to an older message is never reported.
 */
export async function readOutlookPosition(
  send: typeof fetch,
  accessToken: string,
  now = new Date(),
): Promise<string> {
  const query = new URLSearchParams({
    $select: "id",
    $filter: `receivedDateTime ge ${now.toISOString()}`,
  });

  return (await readDelta(send, accessToken, `/mailFolders/inbox/messages/delta?${query}`))
    .deltaLink;
}

/**
 * Reads new mail from the inbox of a Microsoft mailbox with a delta query (decision 0060). The
 * cursor is a delta link. Without one, or when Graph can no longer resume from it, the result is a
 * new position from the current time and no emails. Drafts are left out, a message that was
 * deleted after it arrived is skipped, and a message that does not have the expected shape is
 * reported in `unreadable`.
 */
export async function fetchNewOutlookMail(
  send: typeof fetch,
  accessToken: string,
  cursor: string | null,
): Promise<FetchResult> {
  const baseline = async (): Promise<FetchResult> => ({
    emails: [],
    cursor: await readOutlookPosition(send, accessToken),
    baseline: true,
    unreadable: [],
  });

  if (cursor === null) {
    return baseline();
  }

  let delta: { ids: string[]; deltaLink: string };

  try {
    delta = await readDelta(send, accessToken, cursor);
  } catch (error) {
    if (isExpiredSync(error)) {
      return baseline();
    }

    throw error;
  }

  const emails: FetchedEmail[] = [];
  const unreadable: string[] = [];
  const query = new URLSearchParams({ $select: MESSAGE_FIELDS });

  for (const id of new Set(delta.ids)) {
    let raw: unknown;

    try {
      raw = await getGraph(send, accessToken, `/messages/${encodeURIComponent(id)}?${query}`);
    } catch (error) {
      if (isNotFound(error)) {
        continue;
      }

      throw error;
    }

    const message = messageSchema.safeParse(raw);

    if (!message.success) {
      unreadable.push(id);
    } else if (!message.data.isDraft) {
      emails.push(parseOutlookMessage(message.data));
    }
  }

  return { emails, cursor: delta.deltaLink, baseline: false, unreadable };
}

const profileSchema = z.object({
  mail: z.string().nullish(),
  userPrincipalName: z.string().nullish(),
});

/**
 * Returns the address of the mailbox, which is its primary SMTP address and, for an account that
 * has none, its user principal name. The deliverer compares senders and recipients with this
 * address so that the account never answers itself, and a sign-in name can differ from it.
 */
export async function readOutlookAddress(send: typeof fetch, accessToken: string): Promise<string> {
  const profile = profileSchema.parse(
    await getGraph(send, accessToken, "?$select=mail,userPrincipalName"),
  );

  const address = (profile.mail || profile.userPrincipalName)?.trim().toLowerCase();

  if (!address) {
    throw new Error("Graph did not return the address of the mailbox");
  }

  return address;
}

const replyContextSchema = z.object({
  internetMessageId: z.string().nullish(),
  replyTo: z.array(recipientSchema).nullish(),
});

/**
 * Reads what a reply needs from the original. Exchange joins a reply to the conversation of the
 * original itself (decision 0060), so the `Reply-To` address is the only value that changes the
 * reply. The `Message-ID` is read so that the delivery record names the original, and `References`
 * is not read.
 */
export async function readOutlookReplyContext(
  send: typeof fetch,
  accessToken: string,
  providerMessageId: string,
): Promise<ReplyContext> {
  const query = new URLSearchParams({ $select: "internetMessageId,replyTo" });

  const message = replyContextSchema.parse(
    await getGraph(
      send,
      accessToken,
      `/messages/${encodeURIComponent(providerMessageId)}?${query}`,
    ),
  );

  return {
    messageId: message.internetMessageId?.trim() || null,
    references: null,
    replyTo: addressOf(message.replyTo?.[0]),
  };
}

const createdSchema = z.object({ id: z.string().min(1) });

/** Makes one request of a delivery, with the errors of `deliveryRequest`, and returns the answer. */
async function writeGraph(
  send: typeof fetch,
  accessToken: string,
  method: "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<unknown> {
  const init: RequestInit =
    body === undefined
      ? { method, headers: graphHeaders(accessToken) }
      : {
          method,
          headers: { ...graphHeaders(accessToken), "content-type": "application/json" },
          body: JSON.stringify(body),
        };

  const response = await deliveryRequest(send, `${API_URL}${path}`, init, {
    service: "Graph",
    label: `${method} ${pathOf(`${API_URL}${path}`)}`,
  });

  return response.status === 202 || response.status === 204 ? null : response.json();
}

/**
 * Ends a delivery whose draft exists but was not sent, and throws the error to report. The draft
 * is deleted first. Only when the deletion succeeded may the delivery be retried, so a retry never
 * leaves a second draft in the mailbox. When the draft is still there, or Graph refused the
 * delivery, the failure is a refusal that is not retried.
 */
async function abandonDraft(
  send: typeof fetch,
  accessToken: string,
  id: string,
  error: unknown,
): Promise<never> {
  const deleted = await writeGraph(
    send,
    accessToken,
    "DELETE",
    `/messages/${encodeURIComponent(id)}`,
  )
    .then(() => true)
    .catch(() => false);

  if (error instanceof DeliveryRejectedError) {
    throw error;
  }

  const message = error instanceof Error ? error.message : String(error);

  throw deleted
    ? new DeliveryNotSentError(message)
    : new DeliveryRejectedError("rejected", `${message}, and the draft could not be deleted`);
}

/**
 * Creates the reply as a draft in the conversation of the original, sets its recipient, subject
 * and plain-text body, and returns the id of the draft (decision 0060). Nothing is sent, so a
 * failure after the draft exists is never an unknown outcome: the draft is abandoned.
 */
export async function createOutlookDraft(
  send: typeof fetch,
  accessToken: string,
  reply: OutboundReply,
): Promise<DeliveryReceipt> {
  const created = createdSchema.safeParse(
    await writeGraph(
      send,
      accessToken,
      "POST",
      `/messages/${encodeURIComponent(reply.providerMessageId)}/createReply`,
    ),
  );

  if (!created.success) {
    throw new DeliveryRejectedError("rejected", "Graph created the reply without returning its id");
  }

  try {
    const response = await writeGraph(
      send,
      accessToken,
      "PATCH",
      `/messages/${encodeURIComponent(created.data.id)}`,
      {
        subject: reply.subject,
        body: { contentType: "text", content: reply.body },
        toRecipients: [{ emailAddress: { address: reply.to } }],
        ccRecipients: [],
        bccRecipients: [],
      },
    );

    return { id: created.data.id, response };
  } catch (error) {
    return abandonDraft(send, accessToken, created.data.id, error);
  }
}

/**
 * Sends the reply by creating its draft and sending it, and returns the id of the sent message
 * (decision 0060). When the send is known not to have happened, the draft is abandoned. When its
 * outcome is not known, the draft is left as it is and the error is rethrown.
 */
export async function sendOutlookReply(
  send: typeof fetch,
  accessToken: string,
  reply: OutboundReply,
): Promise<DeliveryReceipt> {
  const draft = await createOutlookDraft(send, accessToken, reply);

  try {
    await writeGraph(send, accessToken, "POST", `/messages/${encodeURIComponent(draft.id)}/send`);
  } catch (error) {
    if (error instanceof DeliveryNotSentError || error instanceof DeliveryRejectedError) {
      return abandonDraft(send, accessToken, draft.id, error);
    }

    throw error;
  }

  return draft;
}
