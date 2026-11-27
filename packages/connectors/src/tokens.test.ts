import { InvalidGrantError, encryptCredentials } from "@leren/channels";
import { connectors as connectorsTable, users } from "@leren/db";
import { createTestDatabase } from "@leren/db/testing";
import type { TestDatabase } from "@leren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { defineConnector } from "./definitions";
import { getConnectorAccessToken, listConnectorSessions, readConnectorTokens } from "./tokens";
import type { Connector, ConnectorTokens } from "./types";

const KEY = Buffer.alloc(32, 7);
const NOW = new Date("2026-11-27T12:00:00.000Z");

const fresh: ConnectorTokens = {
  accessToken: "access",
  refreshToken: "refresh",
  expiresAt: "2026-11-27T13:00:00.000Z",
  clientId: null,
};

describe("connector tokens", () => {
  let database: TestDatabase;
  let userId: string;
  const refresh = vi.fn<Connector["refresh"]>();

  const notion: Connector = {
    definition: defineConnector("notion"),
    start: vi.fn(),
    finish: vi.fn(),
    refresh,
    revoke: vi.fn(),
  };

  const dependencies = { connectors: new Map([["notion", notion]]), encryptionKey: KEY };

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database.drop();
  });

  beforeEach(async () => {
    refresh.mockReset();
    await database.db.delete(users);
    [{ id: userId }] = await database.db
      .insert(users)
      .values({ email: "ada@example.com" })
      .returning({ id: users.id });
  });

  /** Stores a connection of `connector` with `tokens`, encrypted as the API stores them. */
  async function connect(tokens: ConnectorTokens | null, connector = "notion") {
    const [row] = await database.db
      .insert(connectorsTable)
      .values({ userId, connector, providerAccountId: "ws-1", label: "Acme" })
      .returning();

    const id = row?.id ?? "";
    const credentials = tokens && encryptCredentials(KEY, id, JSON.stringify(tokens));

    const [stored] = await database.db
      .update(connectorsTable)
      .set({ credentials })
      .where(eq(connectorsTable.id, id))
      .returning();

    if (!stored) {
      throw new Error("The connection was not stored");
    }

    return stored;
  }

  async function reload(id: string) {
    const [row] = await database.db
      .select()
      .from(connectorsTable)
      .where(eq(connectorsTable.id, id));

    return row;
  }

  describe("getConnectorAccessToken", () => {
    it("returns the stored token while it is valid", async () => {
      const row = await connect(fresh);

      expect(await getConnectorAccessToken(database.db, dependencies, row, NOW)).toBe("access");
      expect(refresh).not.toHaveBeenCalled();
    });

    it("returns a token that never expires without refreshing it", async () => {
      const row = await connect({ ...fresh, expiresAt: null });

      expect(await getConnectorAccessToken(database.db, dependencies, row, NOW)).toBe("access");
    });

    it("returns nothing for a connector that is off, a revoked connection or one without tokens", async () => {
      const off = await connect(fresh, "google_docs");
      const empty = await connect(null);

      expect(await getConnectorAccessToken(database.db, dependencies, off, NOW)).toBeNull();
      expect(await getConnectorAccessToken(database.db, dependencies, empty, NOW)).toBeNull();
      expect(
        await getConnectorAccessToken(
          database.db,
          dependencies,
          { ...empty, status: "revoked" },
          NOW,
        ),
      ).toBeNull();
    });

    it("refreshes a token that expires within a minute and stores the new tokens", async () => {
      const row = await connect({ ...fresh, expiresAt: "2026-11-27T12:00:30.000Z" });
      refresh.mockResolvedValue({ ...fresh, accessToken: "renewed" });

      expect(await getConnectorAccessToken(database.db, dependencies, row, NOW)).toBe("renewed");

      const stored = await reload(row.id);

      expect(stored && readConnectorTokens(dependencies, stored)?.accessToken).toBe("renewed");
    });

    it("revokes the connection when the provider rejects the refresh token", async () => {
      const row = await connect({ ...fresh, expiresAt: "2026-11-27T11:00:00.000Z" });
      refresh.mockRejectedValue(new InvalidGrantError());

      expect(await getConnectorAccessToken(database.db, dependencies, row, NOW)).toBeNull();
      expect((await reload(row.id))?.status).toBe("revoked");
    });

    it("keeps the connection when a concurrent refresh already stored new tokens", async () => {
      const row = await connect({ ...fresh, expiresAt: "2026-11-27T11:00:00.000Z" });
      refresh.mockImplementation(async () => {
        await database.db
          .update(connectorsTable)
          .set({
            credentials: encryptCredentials(
              KEY,
              row.id,
              JSON.stringify({ ...fresh, accessToken: "from-the-other-refresh" }),
            ),
          })
          .where(eq(connectorsTable.id, row.id));

        throw new InvalidGrantError();
      });

      expect(await getConnectorAccessToken(database.db, dependencies, row, NOW)).toBe(
        "from-the-other-refresh",
      );
      expect((await reload(row.id))?.status).toBe("active");
    });

    it("revokes the connection when the tokens that replaced the rejected ones have expired too", async () => {
      const row = await connect({ ...fresh, expiresAt: "2026-11-27T11:00:00.000Z" });
      refresh.mockImplementation(async () => {
        await database.db
          .update(connectorsTable)
          .set({
            credentials: encryptCredentials(
              KEY,
              row.id,
              JSON.stringify({ ...fresh, expiresAt: "2026-11-27T11:30:00.000Z" }),
            ),
          })
          .where(eq(connectorsTable.id, row.id));

        throw new InvalidGrantError();
      });

      expect(await getConnectorAccessToken(database.db, dependencies, row, NOW)).toBeNull();
      expect((await reload(row.id))?.status).toBe("revoked");
    });

    it("throws any other failure of the refresh and keeps the connection", async () => {
      const row = await connect({ ...fresh, expiresAt: "2026-11-27T11:00:00.000Z" });
      refresh.mockRejectedValue(new Error("provider down"));

      await expect(getConnectorAccessToken(database.db, dependencies, row, NOW)).rejects.toThrow(
        "provider down",
      );
      expect((await reload(row.id))?.status).toBe("active");
    });
  });

  describe("listConnectorSessions", () => {
    it("returns a session for each active connection of an enabled connector", async () => {
      await connect({ ...fresh, expiresAt: null });
      await connect({ ...fresh, expiresAt: null }, "google_docs");

      const sessions = await listConnectorSessions(database.db, dependencies, userId);

      expect(sessions).toEqual([
        {
          id: "notion",
          url: notion.definition.mcpUrl,
          token: "access",
          allowedTools: notion.definition.allowedTools,
        },
      ]);
    });

    it("leaves out a connection without tokens", async () => {
      await connect(null);

      expect(await listConnectorSessions(database.db, dependencies, userId)).toEqual([]);
    });

    it("leaves out and reports a connection whose token cannot be obtained", async () => {
      await connect({ ...fresh, expiresAt: "2000-01-01T00:00:00.000Z" });
      refresh.mockRejectedValue(new Error("provider down"));
      const onError = vi.fn();

      expect(await listConnectorSessions(database.db, dependencies, userId, onError)).toEqual([]);
      expect(onError).toHaveBeenCalledExactlyOnceWith("notion", expect.any(Error));
    });
  });
});
