import { createTestDatabase } from "@leren/db/testing";
import type { TestDatabase } from "@leren/db/testing";
import { createInMemoryEmailSender } from "@leren/email/testing";
import type { InMemoryEmailSender } from "@leren/email/testing";
import type { Logger } from "@leren/logger";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createApp } from "../../app";
import { createAuth } from "../auth/service";

const ORIGIN = "http://localhost:5173";
const SESSIONS = "/api/mcp/sessions";
const MISSING_ID = "00000000-0000-4000-8000-000000000000";

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

describe("MCP API", () => {
  let database: TestDatabase;
  let sender: InMemoryEmailSender;
  let app: ReturnType<typeof createApp>;

  const post = (path: string, body: unknown) =>
    app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify(body),
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

  const mint = async (cookie: string) => {
    const response = await app.request(SESSIONS, { method: "POST", headers: { cookie } });

    return { status: response.status, body: await response.json() };
  };

  const listTools = (token?: string) => {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    };

    if (token) {
      headers.authorization = `Bearer ${token}`;
    }

    return app.request("/mcp", {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
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

    app = createApp({
      auth,
      db: database.db,
      logger,
      requestKnowledgeIndex: vi.fn(),
      mcp: { secret: "an-mcp-test-secret-of-at-least-32-chars" },
    });
  });

  afterAll(async () => {
    await database.drop();
  });

  it("rejects the session routes without a browser session", async () => {
    expect((await app.request(SESSIONS, { method: "POST" })).status).toBe(401);
    expect((await app.request(`${SESSIONS}/${MISSING_ID}`, { method: "DELETE" })).status).toBe(401);
  });

  it("rejects the MCP endpoint without a token, and does not accept a browser cookie", async () => {
    const cookie = await signIn("cookie@example.com");

    expect((await listTools()).status).toBe(401);
    expect(
      (
        await app.request("/mcp", {
          method: "POST",
          headers: { cookie, "content-type": "application/json" },
          body: "{}",
        })
      ).status,
    ).toBe(401);
  });

  it("mints a token that the MCP endpoint accepts", async () => {
    const cookie = await signIn("minter@example.com");
    const { status, body } = await mint(cookie);

    expect(status).toBe(201);
    expect(body).toEqual({
      token: expect.any(String),
      sessionId: expect.any(String),
      expiresAt: expect.any(String),
    });

    const response = await listTools(body.token);
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(text).toContain("create_playbook");
  });

  it("revokes a session, and the token stops working", async () => {
    const cookie = await signIn("revoker@example.com");
    const { body } = await mint(cookie);

    const revoked = await app.request(`${SESSIONS}/${body.sessionId}`, {
      method: "DELETE",
      headers: { cookie },
    });

    expect(revoked.status).toBe(204);
    expect((await listTools(body.token)).status).toBe(401);

    const again = await app.request(`${SESSIONS}/${body.sessionId}`, {
      method: "DELETE",
      headers: { cookie },
    });

    expect(again.status).toBe(404);
  });

  it("does not let a user revoke the session of another user", async () => {
    const owner = await signIn("owner@example.com");
    const intruder = await signIn("intruder@example.com");
    const { body } = await mint(owner);

    const response = await app.request(`${SESSIONS}/${body.sessionId}`, {
      method: "DELETE",
      headers: { cookie: intruder },
    });

    expect(response.status).toBe(404);
    expect((await listTools(body.token)).status).toBe(200);
  });

  it("rejects a session id that is not a UUID", async () => {
    const cookie = await signIn("badid@example.com");

    const response = await app.request(`${SESSIONS}/nope`, {
      method: "DELETE",
      headers: { cookie },
    });

    expect(response.status).toBe(400);
  });
});
