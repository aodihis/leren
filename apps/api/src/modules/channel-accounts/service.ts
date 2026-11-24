import { randomUUID } from "node:crypto";

import { channelAccounts, users } from "@leren/db";
import { encryptCredentials, readTokens, requireKey } from "@leren/channels";
import type {
  AuthorisedAccount,
  ChannelAccountsDependencies,
  ChannelProvider,
} from "@leren/channels";
import type { Db } from "@leren/db";
import type { Logger } from "@leren/logger";
import { and, asc, eq } from "drizzle-orm";

/** The most accounts a user may have on a channel. */
const ACCOUNT_LIMIT_PER_CHANNEL: Readonly<Record<string, number>> = { email: 1 };

const POSTGRES_UNIQUE_VIOLATION = "23505";

type AccountRow = typeof channelAccounts.$inferSelect;

/** The account as the API returns it. */
export type ChannelAccountView = {
  id: string;
  channel: string;
  provider: string;
  label: string;
  status: AccountRow["status"];
  usable: boolean;
};

/** The outcome of saving a connected account. */
export type SaveResult =
  | { status: "saved"; account: ChannelAccountView }
  | { status: "conflict" }
  | { status: "limit" };

function toView(
  row: AccountRow,
  providers: ReadonlyMap<string, ChannelProvider>,
): ChannelAccountView {
  return {
    id: row.id,
    channel: row.channel,
    provider: row.provider,
    label: row.label,
    status: row.status,
    usable: row.status === "active" && providers.has(row.provider),
  };
}

function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: unknown; cause?: { code?: unknown } } | null) ?? {};

  return code.code === POSTGRES_UNIQUE_VIOLATION || code.cause?.code === POSTGRES_UNIQUE_VIOLATION;
}

/** Lists the user's channel accounts. */
export async function listChannelAccounts(
  db: Db,
  userId: string,
  providers: ReadonlyMap<string, ChannelProvider>,
): Promise<ChannelAccountView[]> {
  const rows = await db
    .select()
    .from(channelAccounts)
    .where(eq(channelAccounts.userId, userId))
    .orderBy(asc(channelAccounts.createdAt));

  return rows.map((row) => toView(row, providers));
}

/** Returns the sign-in address of a user. */
export async function getUserEmail(db: Db, userId: string): Promise<string | null> {
  const [row] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));

  return row?.email ?? null;
}

/** Saves an account authorised by a provider. */
export async function saveAuthorisedAccount(
  db: Db,
  dependencies: ChannelAccountsDependencies,
  userId: string,
  provider: ChannelProvider,
  authorised: AuthorisedAccount,
): Promise<SaveResult> {
  try {
    return await db.transaction(async (tx) => {
      await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update");

      const [existing] = await tx
        .select()
        .from(channelAccounts)
        .where(
          and(
            eq(channelAccounts.channel, provider.channel),
            eq(channelAccounts.provider, provider.name),
            eq(channelAccounts.providerAccountId, authorised.providerAccountId),
          ),
        );

      if (existing && existing.userId !== userId) {
        return { status: "conflict" };
      }

      if (!existing) {
        const owned = await tx
          .select({ id: channelAccounts.id })
          .from(channelAccounts)
          .where(
            and(eq(channelAccounts.userId, userId), eq(channelAccounts.channel, provider.channel)),
          );

        if (owned.length >= (ACCOUNT_LIMIT_PER_CHANNEL[provider.channel] ?? Infinity)) {
          return { status: "limit" };
        }
      }

      const id = existing?.id ?? randomUUID();

      const credentials = authorised.tokens
        ? encryptCredentials(
            requireKey(dependencies.encryptionKey),
            id,
            JSON.stringify(authorised.tokens),
          )
        : null;

      const values = {
        label: authorised.label,
        credentials,
        status: "active",
        syncCursor: authorised.syncCursor ?? null,
        updatedAt: new Date(),
      } as const;

      const [saved] = existing
        ? await tx.update(channelAccounts).set(values).where(eq(channelAccounts.id, id)).returning()
        : await tx
            .insert(channelAccounts)
            .values({
              ...values,
              id,
              userId,
              channel: provider.channel,
              provider: provider.name,
              providerAccountId: authorised.providerAccountId,
            })
            .returning();

      return { status: "saved", account: toView(saved, dependencies.providers) };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { status: "conflict" };
    }

    throw error;
  }
}

/** Disconnects one of the user's accounts. */
export async function disconnectChannelAccount(
  db: Db,
  dependencies: ChannelAccountsDependencies,
  logger: Logger,
  userId: string,
  accountId: string,
): Promise<boolean> {
  const [row] = await db
    .select()
    .from(channelAccounts)
    .where(and(eq(channelAccounts.id, accountId), eq(channelAccounts.userId, userId)));

  if (!row) {
    return false;
  }

  const provider = dependencies.providers.get(row.provider);

  if (provider && row.credentials !== null) {
    try {
      const tokens = readTokens(dependencies, row);

      if (tokens) {
        await provider.revoke(tokens);
      }
    } catch (error) {
      logger.warn("Revoking channel account tokens failed", {
        provider: row.provider,
        accountId: row.id,
        error,
      });
    }
  }

  await db.delete(channelAccounts).where(eq(channelAccounts.id, row.id));

  return true;
}
