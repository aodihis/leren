import { messages, playbooks } from "@leren/db";
import type { Db } from "@leren/db";
import type { EmailProcessMessage } from "@leren/inbox";
import { mintSession, revokeSession } from "@leren/mcp-server";
import type { MintedSession } from "@leren/mcp-server";
import { and, eq, inArray } from "drizzle-orm";

/**
 * How long the session of one reply run lasts, in seconds. It covers the longest run: three drafts
 * of at most five turns each, the judge calls and the searches. A retry of the job opens a new
 * session and never reuses an earlier one.
 */
export const REPLY_SESSION_TTL_SECONDS = 10 * 60;

export type ReplySessionDependencies = {
  db: Db;
  /** The HMAC secret that signs MCP session tokens. It is the one the API uses. */
  secret: string;
  now?: () => Date;
};

/**
 * Opens the MCP session for the reply run of one message (decision 0042). The user comes from the
 * message record and never from the job: the token is bound to the owner of the record, to the
 * message id and to the read-only scopes of the reply role.
 *
 * Throws when the record does not exist, or when a playbook of the job is not the owner's, because
 * such a job was not produced by the gate and must not run. The queue then retries it, and it ends
 * in the dead-letter queue.
 */
export async function openReplySession(
  { db, secret, now }: ReplySessionDependencies,
  message: EmailProcessMessage,
): Promise<MintedSession> {
  const [record] = await db
    .select({ userId: messages.userId })
    .from(messages)
    .where(eq(messages.id, message.messageId));

  if (!record) {
    throw new Error(`The message ${message.messageId} does not exist.`);
  }

  const ids = [...new Set(message.playbooks.map((entry) => entry.playbookId))];

  const owned = await db
    .select({ id: playbooks.id })
    .from(playbooks)
    .where(and(inArray(playbooks.id, ids), eq(playbooks.userId, record.userId)));

  if (owned.length !== ids.length) {
    throw new Error(`A playbook of the message ${message.messageId} is not the owner's.`);
  }

  return mintSession(
    { db, secret, now },
    {
      userId: record.userId,
      role: "reply",
      messageId: message.messageId,
      ttlSeconds: REPLY_SESSION_TTL_SECONDS,
    },
  );
}

/** Ends a reply session when its run is over, so that its token stops working at once. */
export async function closeReplySession(
  { db, now }: Pick<ReplySessionDependencies, "db" | "now">,
  userId: string,
  session: MintedSession,
): Promise<void> {
  await revokeSession({ db, now }, userId, session.sessionId);
}
