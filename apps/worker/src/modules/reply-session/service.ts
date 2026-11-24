import { messages, playbooks } from "@leren/db";
import type { Db } from "@leren/db";
import type { EmailProcessMessage } from "@leren/inbox";
import { mintSession, revokeSession } from "@leren/mcp-server";
import type { MintedSession } from "@leren/mcp-server";
import { NonRetryableError } from "@leren/queue";
import { eq, inArray } from "drizzle-orm";

/** How long a reply run session lasts, in seconds. */
export const REPLY_SESSION_TTL_SECONDS = 10 * 60;

export type ReplySessionDependencies = {
  db: Db;
  /** The secret that signs MCP session tokens. */
  secret: string;
  now?: () => Date;
};

/** Opens the MCP session for a reply run. */
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
      ttlSeconds: REPLY_SESSION_TTL_SECONDS,
    },
  );
}

/** Ends a reply session when its run is over. */
export async function closeReplySession(
  { db, now }: Pick<ReplySessionDependencies, "db" | "now">,
  userId: string,
  session: MintedSession,
): Promise<void> {
  await revokeSession({ db, now }, userId, session.sessionId);
}
