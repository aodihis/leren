import { randomBytes } from "node:crypto";

import { InvalidGrantError, encryptCredentials } from "@leren/channels";
import { createConnectors, listConnectorSessions } from "@leren/connectors";
import type { ConnectorsDependencies } from "@leren/connectors";
import { connectors, users } from "@leren/db";
import { createTestDatabase } from "@leren/db/testing";
import type { TestDatabase } from "@leren/db/testing";
import { createInMemoryEmailSender } from "@leren/email/testing";
import type { InMemoryEmailSender } from "@leren/email/testing";
import type { Logger } from "@leren/logger";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createApp } from "../../app";
import { createAuth } from "../auth/service";

const ORIGIN = "http://localhost:5173";
const PATH = "/api/connectors";
const MCP_SECRET = "an-mcp-test-secret-of-at-least-32-chars";
const COOKIE_SECRET = "a-cookie-test-secret-of-at-least-32-chars";

function createSilentLogger(): Logger {
  const logger: Logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: () => logger,
  };

  return logger;
}

describe("connectors API", () => {
  let database: TestDatabase;
  let sender: InMemoryEmailSender;
  let app: ReturnType<typeof createApp>;
  let dependencies: ConnectorsDependencies;

  const post = (path: string, payload: unknown) =>
    app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify(payload),
    });

  const signIn = async (email: string) => {
    await post("/api/auth/email-otp/send-verification-otp", { email, type: "sign-in" });

    const otp = /\b\d{6}\b/.exec(sender.sent.at(-1)?.text ?? "")?.[0];
    const response = await post("/api/auth/sign-in/email-otp", { email, otp });

    return response.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
  };

  const call = async (cookie: string, method: string, path: string) =>
    app.request(path, { method, headers: { cookie } });

  const connect = async (cookie: string) => {
    const response = await call(cookie, "POST", `${PATH}/notion/connect`);
    const { url } = await response.json();

    const pending = response.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");

    const state = new URL(url).searchParams.get("state") ?? "";

    return call(`${cookie}; ${pending}`, "GET", `${PATH}/notion/callback?code=c&state=${state}`);
  };

  beforeAll(async () => {
    database = await createTestDatabase();
    sender = createInMemoryEmailSender();

    const logger = createSilentLogger();

    const auth = createAuth({
      db: database.db,
      emailSender: sender,
      logger,
      secret: "test-secret-test-secret-test-secret-1234",
      baseURL: "http://localhost:3000",
      trustedOrigins: [ORIGIN],
    });

    const enabled = createConnectors({ CONNECTORS: ["notion"] });
    const notion = enabled.get("notion");

    if (!notion) {
      throw new Error("The notion connector was not built");
    }

    dependencies = {
      connectors: new Map([
        [
          "notion",
          {
            ...notion,
            start: async ({ state }) => ({
              url: `https://mcp.notion.com/authorize?state=${state}`,
              clientId: "registered-client",
            }),
            finish: async ({ clientId }) => ({
              identity: notion.definition.identify({
                workspace_id: "ws-1",
                workspace_name: "Acme",
              }),
              tokens: {
                accessToken: "access-1",
                refreshToken: "refresh-1",
                expiresAt: "2999-01-01T00:00:00.000Z",
                clientId,
              },
            }),
            revoke: vi.fn(async () => {}),
          },
        ],
      ]),
      encryptionKey: randomBytes(32),
    };

    app = createApp({
      auth,
      db: database.db,
      logger,
      requestKnowledgeIndex: vi.fn(),
      mcp: { secret: MCP_SECRET },
      connectors: {
        ...dependencies,
        cookieSecret: COOKIE_SECRET,
        apiUrl: "http://localhost:3000",
        platformUrl: ORIGIN,
      },
    });
  });

  afterAll(async () => {
    await database.drop();
  });

  it("rejects every route without a session", async () => {
    for (const [method, path] of [
      ["GET", PATH],
      ["POST", `${PATH}/notion/connect`],
      ["GET", `${PATH}/notion/callback`],
      ["DELETE", `${PATH}/notion`],
    ]) {
      const response = await app.request(path, { method });

      expect(response.status, `${method} ${path}`).toBe(401);
    }
  });

  it("answers a connector that is not enabled with not found", async () => {
    const cookie = await signIn("disabled@example.com");

    const response = await call(cookie, "POST", `${PATH}/google_docs/connect`);

    expect(response.status).toBe(404);
  });

  it("registers no external server for a user without a connection", async () => {
    const cookie = await signIn("none@example.com");

    const [user] = await database.db
      .select()
      .from(users)
      .where(eq(users.email, "none@example.com"));

    const listed = await call(cookie, "GET", PATH);

    expect(await listed.json()).toMatchObject({
      connections: [],
    });

    expect(await listConnectorSessions(database.db, dependencies, user?.id ?? "")).toEqual([]);
  });

  it("connects, stores encrypted tokens and offers only the read-only tools of that user", async () => {
    const cookie = await signIn("owner@example.com");
    const other = await signIn("other@example.com");

    const response = await connect(cookie);

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("connected=notion");

    const [row] = await database.db.select().from(connectors);

    expect(row?.credentials).not.toContain("access-1");

    const [owner] = await database.db
      .select()
      .from(users)
      .where(eq(users.email, "owner@example.com"));

    const sessions = await listConnectorSessions(database.db, dependencies, owner?.id ?? "");

    expect(sessions).toEqual([
      expect.objectContaining({
        id: "notion",
        url: "https://mcp.notion.com/mcp",
        token: "access-1",
        allowedTools: ["notion-search", "notion-fetch", "notion-query-data-sources"],
      }),
    ]);

    const listedForOther = await call(other, "GET", PATH);

    expect(await listedForOther.json()).toMatchObject({
      connections: [],
    });
  });

  it("rejects a callback whose state does not match", async () => {
    const cookie = await signIn("state@example.com");

    const response = await call(cookie, "GET", `${PATH}/notion/callback?code=c&state=forged`);

    expect(response.headers.get("location")).toContain("error=invalid_state");
  });

  it("registers nothing after the user disconnects", async () => {
    const cookie = await signIn("leaver@example.com");

    await connect(cookie);

    const [leaver] = await database.db
      .select()
      .from(users)
      .where(eq(users.email, "leaver@example.com"));

    expect(await listConnectorSessions(database.db, dependencies, leaver?.id ?? "")).toHaveLength(
      1,
    );

    expect((await call(cookie, "DELETE", `${PATH}/notion`)).status).toBe(204);
    expect(await listConnectorSessions(database.db, dependencies, leaver?.id ?? "")).toEqual([]);
    expect((await call(cookie, "DELETE", `${PATH}/notion`)).status).toBe(404);
  });

  it("keeps a connection that a concurrent refresh has already renewed", async () => {
    const cookie = await signIn("racer@example.com");

    await connect(cookie);

    const [racer] = await database.db
      .select()
      .from(users)
      .where(eq(users.email, "racer@example.com"));

    const [row] = await database.db
      .select()
      .from(connectors)
      .where(eq(connectors.userId, racer?.id ?? ""));

    const key = dependencies.encryptionKey ?? Buffer.alloc(0);

    const stale = JSON.stringify({
      accessToken: "stale",
      refreshToken: "refresh-1",
      expiresAt: "2000-01-01T00:00:00.000Z",
      clientId: "registered-client",
    });

    const renewed = JSON.stringify({
      accessToken: "renewed",
      refreshToken: "refresh-2",
      expiresAt: "2999-01-01T00:00:00.000Z",
      clientId: "registered-client",
    });

    await database.db
      .update(connectors)
      .set({ credentials: encryptCredentials(key, row?.id ?? "", stale) })
      .where(eq(connectors.id, row?.id ?? ""));

    const notion = dependencies.connectors.get("notion");

    if (!notion) {
      throw new Error("The notion connector is missing");
    }

    const racing: ConnectorsDependencies = {
      ...dependencies,
      connectors: new Map([
        [
          "notion",
          {
            ...notion,
            refresh: async () => {
              await database.db
                .update(connectors)
                .set({ credentials: encryptCredentials(key, row?.id ?? "", renewed) })
                .where(eq(connectors.id, row?.id ?? ""));

              throw new InvalidGrantError();
            },
          },
        ],
      ]),
    };

    const sessions = await listConnectorSessions(database.db, racing, racer?.id ?? "");

    expect(sessions.map((session) => session.token)).toEqual(["renewed"]);

    const [after] = await database.db
      .select()
      .from(connectors)
      .where(eq(connectors.id, row?.id ?? ""));

    expect(after?.status).toBe("active");
  });
});
