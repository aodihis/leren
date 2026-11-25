import { randomUUID } from "node:crypto";

import { encryptCredentials, requireKey } from "@leren/channels";
import { readConnectorTokens } from "@leren/connectors";
import type {
  Connector,
  ConnectorTokens,
  ConnectorId,
  ConnectorIdentity,
  ConnectorsDependencies,
} from "@leren/connectors";
import { connectors } from "@leren/db";
import type { Db } from "@leren/db";
import type { Logger } from "@leren/logger";
import { and, asc, eq } from "drizzle-orm";

type ConnectionRow = typeof connectors.$inferSelect;

/** A connector that the deployment has enabled. */
export type AvailableConnector = { id: ConnectorId; displayName: string };

/** A user's connection as the API returns it. Credentials are never part of a view. */
export type ConnectionView = {
  id: string;
  connector: string;
  label: string;
  status: ConnectionRow["status"];
};

function toView(row: ConnectionRow): ConnectionView {
  return { id: row.id, connector: row.connector, label: row.label, status: row.status };
}

/** Lists the enabled connectors. */
export function listAvailableConnectors(
  dependencies: ConnectorsDependencies,
): AvailableConnector[] {
  return [...dependencies.connectors.values()].map(({ definition }) => ({
    id: definition.id,
    displayName: definition.displayName,
  }));
}

/** Lists the user's connections, oldest first. The query is scoped to `userId`. */
export async function listConnections(db: Db, userId: string): Promise<ConnectionView[]> {
  const rows = await db
    .select()
    .from(connectors)
    .where(eq(connectors.userId, userId))
    .orderBy(asc(connectors.createdAt));

  return rows.map(toView);
}

/**
 * Saves the authorisation of a connector for `userId`. Connecting a connector again replaces its
 * credentials and makes the connection active. The id of the row is the additional authenticated
 * data of its encrypted credentials, so it is chosen before the credentials are encrypted.
 */
export async function saveConnection(
  db: Db,
  dependencies: ConnectorsDependencies,
  userId: string,
  connector: Connector,
  authorised: { identity: ConnectorIdentity; tokens: ConnectorTokens },
): Promise<ConnectionView> {
  const [existing] = await db
    .select({ id: connectors.id })
    .from(connectors)
    .where(and(eq(connectors.userId, userId), eq(connectors.connector, connector.definition.id)));

  const id = existing?.id ?? randomUUID();

  const credentials = encryptCredentials(
    requireKey(dependencies.encryptionKey),
    id,
    JSON.stringify(authorised.tokens),
  );

  const values = {
    providerAccountId: authorised.identity.providerAccountId,
    label: authorised.identity.label,
    credentials,
    status: "active" as const,
    updatedAt: new Date(),
  };

  const [saved] = existing
    ? await db.update(connectors).set(values).where(eq(connectors.id, id)).returning()
    : await db
        .insert(connectors)
        .values({ id, userId, connector: connector.definition.id, ...values })
        .returning();

  if (!saved) {
    throw new Error("The connection was not saved");
  }

  return toView(saved);
}

/**
 * Deletes the user's connection to a connector and revokes its tokens at the authorization
 * server. A failure of the revocation call is logged and does not keep the row. Returns false when
 * the user has no such connection.
 */
export async function disconnectConnector(
  db: Db,
  dependencies: ConnectorsDependencies,
  logger: Logger,
  userId: string,
  connectorId: string,
): Promise<boolean> {
  const [row] = await db
    .select()
    .from(connectors)
    .where(and(eq(connectors.userId, userId), eq(connectors.connector, connectorId)));

  if (!row) {
    return false;
  }

  const connector = dependencies.connectors.get(row.connector);

  if (connector && row.credentials !== null) {
    try {
      const tokens = readConnectorTokens(dependencies, row);

      if (tokens) {
        await connector.revoke(tokens);
      }
    } catch (error) {
      logger.warn("Revoking connector tokens failed", {
        connector: row.connector,
        connectionId: row.id,
        error,
      });
    }
  }

  await db.delete(connectors).where(eq(connectors.id, row.id));

  return true;
}
