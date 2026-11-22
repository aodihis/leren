import { randomUUID } from "node:crypto";

import { channelAccounts, users } from "@leren/db";
import type { Db } from "@leren/db";
import type { Logger } from "@leren/logger";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { decryptCredentials, encryptCredentials } from "./crypto";
import { InvalidGrantError } from "./providers/types";
import type { AuthorisedAccount, ChannelProvider, ProviderTokens } from "./providers/types";

/** How many accounts a user may have on a channel in the first version (decision 0021). */
const ACCOUNT_LIMIT_PER_CHANNEL: Readonly<Record<string, number>> = { email: 1 };

/** An access token that expires within this many milliseconds is refreshed before it is used. */
const REFRESH_MARGIN_MS = 60_000;

const POSTGRES_UNIQUE_VIOLATION = "23505";

/**
 * What the account functions need from the process: the enabled providers, and the key that
 * encrypts credentials. The key is undefined when no enabled provider stores tokens.
 */
export type ChannelAccountsDependencies = {
  providers: ReadonlyMap<string, ChannelProvider>;
  encryptionKey: Buffer | undefined;
};

type AccountRow = typeof channelAccounts.$inferSelect;

/**
 * The account as the API returns it. `usable` is true when the account is active and its provider
 * is enabled. Credentials are never part of a view.
 */
export type ChannelAccountView = {
  id: string;
  channel: string;
  provider: string;
  label: string;
  status: AccountRow["status"];
  usable: boolean;
};

/**
 * The outcome of saving a connected account. `conflict` means that the provider's account belongs
 * to another user. `limit` means that the user already has the most accounts that the channel
 * allows.
 */
export type SaveResult =
  | { status: "saved"; account: ChannelAccountView }
  | { status: "conflict" }
  | { status: "limit" };

const storedTokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string().nullable(),
  expiresAt: z.string().nullable(),
});

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

function requireKey(key: Buffer | undefined): Buffer {
  if (!key) {
    throw new Error("CHANNEL_TOKEN_ENCRYPTION_KEY is not configured");
  }

  return key;
}

function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: unknown; cause?: { code?: unknown } } | null) ?? {};

  return code.code === POSTGRES_UNIQUE_VIOLATION || code.cause?.code === POSTGRES_UNIQUE_VIOLATION;
}

/** Lists the user's channel accounts, oldest first. The query is scoped to `userId`. */
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

/** Returns the sign-in address of a user, which a provider without OAuth identifies the account by. */
export async function getUserEmail(db: Db, userId: string): Promise<string | null> {
  const [row] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));

  return row?.email ?? null;
}

/**
 * Saves an account that a provider has authorised for `userId`.
 *
 * The user's row is locked for the transaction, so two connections of one user cannot both pass
 * the account limit. An account that already belongs to this user has its label and credentials
 * replaced and becomes active again. An account of another user is a conflict, which the unique
 * index also enforces if two users connect it at once. The id of the account is the additional
 * authenticated data of its encrypted credentials.
 */
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

function readTokens(
  dependencies: ChannelAccountsDependencies,
  row: AccountRow,
): ProviderTokens | null {
  if (row.credentials === null) {
    return null;
  }

  const plaintext = decryptCredentials(
    requireKey(dependencies.encryptionKey),
    row.id,
    row.credentials,
  );

  return storedTokensSchema.parse(JSON.parse(plaintext));
}

/**
 * Returns a valid access token for one of the user's accounts, or `null` when the account does not
 * exist, belongs to another user, is not usable or has no credentials. A token that has expired, or
 * expires within a minute, is refreshed and the new credentials are stored. When the provider
 * rejects the refresh token, the account becomes `revoked` and the result is `null`. Other
 * failures are thrown, because they may succeed on a retry.
 */
export async function getAccessToken(
  db: Db,
  dependencies: ChannelAccountsDependencies,
  userId: string,
  accountId: string,
  now = new Date(),
): Promise<string | null> {
  const [row] = await db
    .select()
    .from(channelAccounts)
    .where(and(eq(channelAccounts.id, accountId), eq(channelAccounts.userId, userId)));

  const provider = row ? dependencies.providers.get(row.provider) : undefined;

  if (!row || !provider || row.status !== "active") {
    return null;
  }

  const tokens = readTokens(dependencies, row);

  if (!tokens) {
    return null;
  }

  const expiresAt = tokens.expiresAt ? Date.parse(tokens.expiresAt) : Infinity;

  if (expiresAt - now.getTime() > REFRESH_MARGIN_MS) {
    return tokens.accessToken;
  }

  try {
    const refreshed = await provider.refresh(tokens);

    await db
      .update(channelAccounts)
      .set({
        credentials: encryptCredentials(
          requireKey(dependencies.encryptionKey),
          row.id,
          JSON.stringify(refreshed),
        ),
        updatedAt: new Date(),
      })
      .where(eq(channelAccounts.id, row.id));

    return refreshed.accessToken;
  } catch (error) {
    if (error instanceof InvalidGrantError) {
      await db
        .update(channelAccounts)
        .set({ status: "revoked", updatedAt: new Date() })
        .where(eq(channelAccounts.id, row.id));

      return null;
    }

    throw error;
  }
}

/**
 * Disconnects one of the user's accounts: revokes its tokens at the provider and deletes the row.
 * Returns `false` when the account does not exist or belongs to another user. The row is deleted
 * even when the provider is disabled, the tokens cannot be read or revoking them fails, so a user
 * can always remove an account. A failure is logged without the tokens.
 */
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
