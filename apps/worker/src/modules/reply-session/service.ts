import { messages, playbooks } from "@leren/db";
import type { Db } from "@leren/db";
import type { EmailProcessMessage } from "@leren/inbox";
import { mintSession, revokeSession } from "@leren/mcp-server";
import type { MintedSession } from "@leren/mcp-server";
import { NonRetryableError } from "@leren/queue";
import { eq, inArray } from "drizzle-orm";

/**
 * How long the session of one reply run lasts, in seconds. It covers the longest run: three runs of
 * the answering agent of at most six turns each, with their searches, and the judge calls. A retry of the job opens a new
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
 * message id and to the read-only scopes of the reply role. It reads only the playbooks of the job,
 * which the gate allowed for the message, so the answering agent never sees a playbook whose
 * conditions exclude the sender.
 *
 * Throws when the record does not exist, or when a playbook of the job belongs to another user, because
 * such a job was not produced by the gate and must not run. The error is not retried. A playbook
 * that no longer exists is not an error: the user may have deleted it after the gate queued the
 * message, and the pipeline escalates when no playbook is left to use.
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
    throw new NonRetryableError(`The message ${message.messageId} does not exist.`);
  }

  const ids = [...new Set(message.playbooks.map((entry) => entry.playbookId))];

  const found = await db
    .select({ userId: playbooks.userId })
    .from(playbooks)
    .where(inArray(playbooks.id, ids));

  if (found.some((playbook) => playbook.userId !== record.userId)) {
    throw new NonRetryableError(
      `A playbook of the message ${message.messageId} is not the owner's.`,
    );
  }

  return mintSession(
    { db, secret, now },
    {
      userId: record.userId,
      role: "reply",
      messageId: message.messageId,
      playbookIds: ids,
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
