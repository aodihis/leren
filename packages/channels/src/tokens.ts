import { channelAccounts } from "@leren/db";
import type { Db } from "@leren/db";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { decryptCredentials, encryptCredentials } from "./crypto";
import { InvalidGrantError } from "./providers/types";
import type { ChannelProvider, ProviderTokens } from "./providers/types";

/** An access token that expires within this many milliseconds is refreshed before it is used. */
const REFRESH_MARGIN_MS = 60_000;

/**
 * What the account functions need from the process: the enabled providers, and the key that
 * encrypts credentials. The key is undefined when no enabled provider stores tokens.
 */
export type ChannelAccountsDependencies = {
  providers: ReadonlyMap<string, ChannelProvider>;
  encryptionKey: Buffer | undefined;
};

type AccountRow = typeof channelAccounts.$inferSelect;

const storedTokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string().nullable(),
  expiresAt: z.string().nullable(),
});

/** Returns the key, or throws when no enabled provider was configured with one. */
export function requireKey(key: Buffer | undefined): Buffer {
  if (!key) {
    throw new Error("CHANNEL_TOKEN_ENCRYPTION_KEY is not configured");
  }

  return key;
}

/** Decrypts the credentials of an account row, or returns `null` when the account has none. */
export function readTokens(
  dependencies: ChannelAccountsDependencies,
  row: Pick<AccountRow, "id" | "credentials">,
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
      await markAccountRevoked(db, row);

      return null;
    }

    throw error;
  }
}

/**
 * Runs a provider call that uses the credentials of `account`. When the mailbox refuses them, the
 * call throws `InvalidGrantError`, the account becomes `revoked` and the result says so, because
 * nothing can be done for the account until it is connected again. Any other error is thrown.
 */
export async function revokeOnRefusedCredentials<T>(
  db: Db,
  account: Pick<AccountRow, "id" | "credentials">,
  call: () => Promise<T>,
): Promise<{ revoked: false; value: T } | { revoked: true }> {
  try {
    return { revoked: false, value: await call() };
  } catch (error) {
    if (error instanceof InvalidGrantError) {
      await markAccountRevoked(db, account);

      return { revoked: true };
    }

    throw error;
  }
}

/**
 * Makes an account `revoked` because the credentials that `account` holds stopped working
 * (decision 0062). Only connecting the account again makes it active. The account is changed only
 * while it still holds those credentials, so a connection that replaced them in the meantime stays
 * active.
 */
export async function markAccountRevoked(
  db: Db,
  account: Pick<AccountRow, "id" | "credentials">,
): Promise<void> {
  await db
    .update(channelAccounts)
    .set({ status: "revoked", updatedAt: new Date() })
    .where(
      and(
        eq(channelAccounts.id, account.id),
        account.credentials === null
          ? isNull(channelAccounts.credentials)
          : eq(channelAccounts.credentials, account.credentials),
      ),
    );
}
