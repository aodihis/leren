import { getAccessToken, isEmailProvider } from "@leren/channels";
import type { ChannelAccountsDependencies } from "@leren/channels";
import { channelAccounts } from "@leren/db";
import type { Db } from "@leren/db";
import type { InboundEmail } from "@leren/inbox";
import { and, eq, inArray, isNull } from "drizzle-orm";

export type EmailPollDependencies = {
  db: Db;
  channels: ChannelAccountsDependencies;
  /** Records an email and publishes email.received. */
  recordEmail: (email: InboundEmail) => Promise<unknown>;
};

/** The outcome of a poll. */
export type PollOutcome =
  | { kind: "ingested"; count: number; unreadable: string[] }
  | { kind: "baseline"; gap: boolean }
  | { kind: "skipped" };

/** Returns the ids of the accounts to poll. */
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

/** Reads the new mail of one account. */
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

  const result = await provider.fetchNewMail(accessToken, account.syncCursor);

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
