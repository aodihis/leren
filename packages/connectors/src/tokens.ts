import {
  InvalidGrantError,
  decryptCredentials,
  encryptCredentials,
  requireKey,
} from "@leren/channels";
import { connectors as connectorsTable } from "@leren/db";
import type { Db } from "@leren/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import type { Connector, ConnectorTokens } from "./types";

/** An access token that expires within this many milliseconds is refreshed before it is used. */
const REFRESH_MARGIN_MS = 60_000;

/** What the connector functions need from the process: the enabled connectors and the key. */
export type ConnectorsDependencies = {
  connectors: ReadonlyMap<string, Connector>;
  encryptionKey: Buffer | undefined;
};

type ConnectorRow = typeof connectorsTable.$inferSelect;

const storedTokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string().nullable(),
  expiresAt: z.string().nullable(),
  clientId: z.string().nullable().default(null),
});

/** Decrypts the credentials of a connection, or returns `null` when it has none. */
export function readConnectorTokens(
  dependencies: Pick<ConnectorsDependencies, "encryptionKey">,
  row: Pick<ConnectorRow, "id" | "credentials">,
): ConnectorTokens | null {
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
 * Returns a valid access token for a connection, or `null` when its connector is disabled or it is
 * inactive or has no credentials. A token that expires within a minute is refreshed and stored. A
 * rejected refresh token makes the connection `revoked` and returns `null`. Other failures are
 * thrown.
 */
export async function getConnectorAccessToken(
  db: Db,
  dependencies: ConnectorsDependencies,
  row: ConnectorRow,
  now = new Date(),
): Promise<string | null> {
  const connector = dependencies.connectors.get(row.connector);

  if (!connector || row.status !== "active") {
    return null;
  }

  const tokens = readConnectorTokens(dependencies, row);

  if (!tokens) {
    return null;
  }

  const expiresAt = tokens.expiresAt ? Date.parse(tokens.expiresAt) : Infinity;

  if (expiresAt - now.getTime() > REFRESH_MARGIN_MS) {
    return tokens.accessToken;
  }

  try {
    const refreshed = await connector.refresh(tokens);

    await db
      .update(connectorsTable)
      .set({
        credentials: encryptCredentials(
          requireKey(dependencies.encryptionKey),
          row.id,
          JSON.stringify(refreshed),
        ),
        updatedAt: new Date(),
      })
      .where(eq(connectorsTable.id, row.id));

    return refreshed.accessToken;
  } catch (error) {
    if (error instanceof InvalidGrantError) {
      const current = await replacedAccessToken(db, dependencies, row, now);

      if (current) {
        return current;
      }

      await db
        .update(connectorsTable)
        .set({ status: "revoked", updatedAt: new Date() })
        .where(eq(connectorsTable.id, row.id));

      return null;
    }

    throw error;
  }
}

/**
 * Returns the access token that a concurrent refresh stored, or `null` when the stored credentials
 * are still the rejected ones. A server that rotates refresh tokens rejects the second of two
 * refreshes with the same token, and that must not revoke a connection the first has renewed.
 */
async function replacedAccessToken(
  db: Db,
  dependencies: ConnectorsDependencies,
  rejected: ConnectorRow,
  now: Date,
): Promise<string | null> {
  const [latest] = await db
    .select()
    .from(connectorsTable)
    .where(eq(connectorsTable.id, rejected.id));

  if (!latest || latest.credentials === rejected.credentials) {
    return null;
  }

  const tokens = readConnectorTokens(dependencies, latest);

  const valid = tokens?.expiresAt ? Date.parse(tokens.expiresAt) - now.getTime() > 0 : true;

  return tokens && valid ? tokens.accessToken : null;
}

/** What the assistant needs to open one external MCP server on behalf of a user. */
export type ConnectorSession = {
  id: string;
  url: string;
  token: string;
  allowedTools: readonly string[];
};

/**
 * Returns the sessions of the user's active connections whose connector is enabled. A connection
 * whose token cannot be obtained is left out and reported to `onError`, so one broken connection
 * does not stop the others or the run.
 */
export async function listConnectorSessions(
  db: Db,
  dependencies: ConnectorsDependencies,
  userId: string,
  onError: (connector: string, error: unknown) => void = () => {},
): Promise<ConnectorSession[]> {
  const rows = await db
    .select()
    .from(connectorsTable)
    .where(and(eq(connectorsTable.userId, userId), eq(connectorsTable.status, "active")));

  const sessions = await Promise.all(
    rows.map(async (row): Promise<ConnectorSession | null> => {
      const connector = dependencies.connectors.get(row.connector);

      if (!connector) {
        return null;
      }

      try {
        const token = await getConnectorAccessToken(db, dependencies, row);

        return token
          ? {
              id: row.connector,
              url: connector.definition.mcpUrl,
              token,
              allowedTools: connector.definition.allowedTools,
            }
          : null;
      } catch (error) {
        onError(row.connector, error);

        return null;
      }
    }),
  );

  return sessions.filter((session) => session !== null);
}
