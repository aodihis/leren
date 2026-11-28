import { getAccessToken, isEmailProvider, revokeOnRefusedCredentials } from "@leren/channels";
import type { ChannelAccountsDependencies } from "@leren/channels";
import { channelAccounts } from "@leren/db";
import type { Db } from "@leren/db";
import type { InboundEmail } from "@leren/inbox";
import { and, eq, inArray, isNull } from "drizzle-orm";

export type EmailPollDependencies = {
  db: Db;
  channels: ChannelAccountsDependencies;
  /** Records an email and publishes it to `email.received`. */
  recordEmail: (email: InboundEmail) => Promise<unknown>;
};

/**
 * What a poll did: `ingested` recorded `count` emails and lists the `unreadable` ones, `baseline`
 * stored the mailbox position without recording, and `gap` means the old cursor could not be
 * resumed. `skipped` means the account cannot be polled, and `revoked` means the mailbox refused
 * its credentials (decision 0062).
 */
export type PollOutcome =
  | { kind: "ingested"; count: number; unreadable: string[] }
  | { kind: "baseline"; gap: boolean }
  | { kind: "skipped" }
  | { kind: "revoked" };

/**
 * Returns the ids of the accounts that the listener polls: the active accounts whose provider is
 * enabled and can read a mailbox.
 */
export async function listPollableAccountIds(
  db: Db,
  providers: ChannelAccountsDependencies["providers"],
): Promise<string[]> {
  const readers = [...providers.values()].flatMap((provider) =>
    isEmailProvider(provider) ? [provider.name] : [],
  );

  if (readers.length === 0) {
    return [];
  }

  const rows = await db
    .select({ id: channelAccounts.id })
    .from(channelAccounts)
    .where(and(eq(channelAccounts.status, "active"), inArray(channelAccounts.provider, readers)));

  return rows.map((row) => row.id);
}

/**
 * Reads the new mail of one account and records it (decision 0041). The cursor is stored only after
 * every email is recorded, and only while it is still the cursor that was read, so a failure loses
 * no mail and overlapping polls never move it backwards.
 */
export async function pollAccount(
  { db, channels, recordEmail }: EmailPollDependencies,
  accountId: string,
): Promise<PollOutcome> {
  const [account] = await db
    .select()
    .from(channelAccounts)
    .where(eq(channelAccounts.id, accountId));

  const provider = account ? channels.providers.get(account.provider) : undefined;

  if (!account || account.status !== "active" || !provider || !isEmailProvider(provider)) {
    return { kind: "skipped" };
  }

  const accessToken = await getAccessToken(db, channels, account.userId, account.id);

  if (accessToken === null) {
    return { kind: "skipped" };
  }

  const fetched = await revokeOnRefusedCredentials(db, account, () =>
    provider.fetchNewMail(accessToken, account.syncCursor),
  );

  if (fetched.revoked) {
    return { kind: "revoked" };
  }

  const result = fetched.value;

  for (const email of result.emails) {
    await recordEmail({
      ...email,
      userId: account.userId,
      channelAccountId: account.id,
      channel: account.channel,
      provider: account.provider,
    });
  }

  await db
    .update(channelAccounts)
    .set({ syncCursor: result.cursor })
    .where(
      and(
        eq(channelAccounts.id, account.id),
        account.syncCursor === null
          ? isNull(channelAccounts.syncCursor)
          : eq(channelAccounts.syncCursor, account.syncCursor),
      ),
    );

  return result.baseline
    ? { kind: "baseline", gap: account.syncCursor !== null }
    : { kind: "ingested", count: result.emails.length, unreadable: result.unreadable };
}
