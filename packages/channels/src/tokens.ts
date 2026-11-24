import { channelAccounts } from "@leren/db";
import type { Db } from "@leren/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { decryptCredentials, encryptCredentials } from "./crypto";
import { InvalidGrantError } from "./providers/types";
import type { ChannelProvider, ProviderTokens } from "./providers/types";

/** The window before expiry for a token refresh. */
const REFRESH_MARGIN_MS = 60_000;

/** What the account functions need from the process. */
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

/** Returns the encryption key or throws. */
export function requireKey(key: Buffer | undefined): Buffer {
  if (!key) {
    throw new Error("CHANNEL_TOKEN_ENCRYPTION_KEY is not configured");
  }

  return key;
}

/** Decrypts the credentials of an account row. */
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

/** Returns a valid access token for an account. */
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
