import { createTestDatabase } from "@leren/db/testing";
import type { TestDatabase } from "@leren/db/testing";
import { createInMemoryEmailSender } from "@leren/email/testing";
import type { InMemoryEmailSender } from "@leren/email/testing";
import type { Logger } from "@leren/logger";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createApp } from "../../app";
import { createAuth } from "../auth/service";
import type { AutoReplyRuleInput } from "./schema";

const ORIGIN = "http://localhost:5173";
const PATH = "/api/auto-reply-rules";

const MCP_SECRET = "an-mcp-test-secret-of-at-least-32-chars";

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

const validRule: AutoReplyRuleInput = {
  name: "Holiday",
  enabled: true,
  startsAt: null,
  endsAt: null,
  timezone: "Asia/Jakarta",
  conditions: [
    {
      channel: "email",
      senderMode: "any",
      senderAllowlist: [],
      replyWhenTo: true,
      replyWhenCc: false,
      replyWhenBcc: false,
      requireSoleRecipient: false,
      mentionOverrides: true,
      mentionDetection: "alias",
      mentionAliases: ["Bal"],
      threadMode: "both",
      skipBulkMail: true,
    },
  ],
};

const validEmail = validRule.conditions[0];

describe("auto-reply rules API", () => {
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

  const call = (cookie: string, method: string, path: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: { "content-type": "application/json", cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  const create = async (cookie: string, rule: Partial<AutoReplyRuleInput> = {}) => {
    const response = await call(cookie, "POST", PATH, { ...validRule, ...rule });
    const { rule: created } = await response.json();

    return created;
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
      mcp: { secret: MCP_SECRET },
    });
  });

  afterAll(async () => {
    await database.drop();
  });

  it("rejects every route without a session", async () => {
    const id = "00000000-0000-4000-8000-000000000000";

    for (const [method, path] of [
      ["GET", PATH],
      ["POST", PATH],
      ["GET", `${PATH}/${id}`],
      ["PUT", `${PATH}/${id}`],
      ["DELETE", `${PATH}/${id}`],
    ]) {
      const response = await app.request(path, { method });

      expect(response.status).toBe(401);
    }
  });

  it("creates a rule with its conditions and returns the derived status", async () => {
    const cookie = await signIn("creator@example.com");
    const response = await call(cookie, "POST", PATH, validRule);

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      rule: { ...validRule, id: expect.any(String), status: "active" },
    });
  });

  it.each([
    ["scheduled", "2999-01-01T00:00:00.000Z", null],
    ["expired", null, "2000-01-01T00:00:00.000Z"],
    ["active", "2000-01-01T00:00:00.000Z", "2999-01-01T00:00:00.000Z"],
  ] as const)("derives the %s status from the stored bounds", async (status, startsAt, endsAt) => {
    const cookie = await signIn(`status-${status}@example.com`);
    const created = await create(cookie, { startsAt, endsAt });
    const response = await call(cookie, "GET", `${PATH}/${created.id}`);

    expect(await response.json()).toMatchObject({ rule: { status, startsAt, endsAt } });
  });

  it("derives the disabled status for a disabled rule", async () => {
    const cookie = await signIn("disabled@example.com");
    const created = await create(cookie, { enabled: false });

    expect(created.status).toBe("disabled");
  });

  it("lists only the signed-in user's rules", async () => {
    const owner = await signIn("lister@example.com");
    const other = await signIn("other-lister@example.com");

    await create(owner, { name: "Mine" });
    await create(other, { name: "Theirs" });

    const response = await call(owner, "GET", PATH);
    const { rules } = await response.json();

    expect(rules.map((rule: { name: string }) => rule.name)).toEqual(["Mine"]);
  });

  it("replaces the rule and its conditions on update", async () => {
    const cookie = await signIn("updater@example.com");
    const created = await create(cookie);

    const changed = {
      ...validRule,
      name: "Renamed",
      conditions: [{ ...validEmail, senderMode: "allowlist", senderAllowlist: ["@acme.com"] }],
    };

    const response = await call(cookie, "PUT", `${PATH}/${created.id}`, changed);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      rule: { ...changed, id: created.id, status: "active" },
    });
  });

  it("deletes a rule", async () => {
    const cookie = await signIn("deleter@example.com");
    const created = await create(cookie);

    const deleted = await call(cookie, "DELETE", `${PATH}/${created.id}`);
    const fetched = await call(cookie, "GET", `${PATH}/${created.id}`);

    expect(deleted.status).toBe(204);
    expect(fetched.status).toBe(404);
  });

  it("does not let user B read, replace or delete user A's rule", async () => {
    const owner = await signIn("owner@example.com");
    const intruder = await signIn("intruder@example.com");
    const created = await create(owner, { name: "Private" });
    const path = `${PATH}/${created.id}`;

    expect((await call(intruder, "GET", path)).status).toBe(404);
    expect((await call(intruder, "PUT", path, { ...validRule, name: "Hacked" })).status).toBe(404);
    expect((await call(intruder, "DELETE", path)).status).toBe(404);

    const unchanged = await call(owner, "GET", path);

    expect(await unchanged.json()).toMatchObject({ rule: { name: "Private" } });
  });

  it("returns 404 for an unknown rule", async () => {
    const cookie = await signIn("unknown@example.com");
    const response = await call(cookie, "GET", `${PATH}/00000000-0000-4000-8000-000000000000`);

    expect(response.status).toBe(404);
  });

  it.each([
    ["a blank name", { name: " " }, "name"],
    [
      "an end before the start",
      { startsAt: "2026-12-10T00:00:00Z", endsAt: "2026-12-01T00:00:00Z" },
      "endsAt",
    ],
    ["an unknown timezone", { timezone: "Mars/Olympus" }, "timezone"],
    ["a bound without an offset", { startsAt: "2026-12-01T00:00:00" }, "startsAt"],
  ] as const)("rejects %s with a field error", async (_name, change, field) => {
    const cookie = await signIn("validation@example.com");
    const response = await call(cookie, "POST", PATH, { ...validRule, ...change });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(Object.keys(body.fieldErrors)).toEqual([field]);
  });

  it("rejects an invalid sender allowlist entry", async () => {
    const cookie = await signIn("allowlist@example.com");
    const conditions = [{ ...validEmail, senderAllowlist: ["not an address"] }];
    const response = await call(cookie, "POST", PATH, { ...validRule, conditions });

    expect(response.status).toBe(400);
  });

  it("normalizes allowlist entries to lowercase", async () => {
    const cookie = await signIn("normalize@example.com");
    const conditions = [{ ...validEmail, senderAllowlist: [" Boss@ACME.com "] }];
    const created = await create(cookie, { conditions });

    expect(created.conditions[0].senderAllowlist).toEqual(["boss@acme.com"]);
  });

  it("rejects a rule without conditions, a repeated channel and an unknown channel", async () => {
    const cookie = await signIn("channels@example.com");

    const none = await call(cookie, "POST", PATH, { ...validRule, conditions: [] });

    const repeated = await call(cookie, "POST", PATH, {
      ...validRule,
      conditions: [validEmail, validEmail],
    });

    const unknown = await call(cookie, "POST", PATH, {
      ...validRule,
      conditions: [{ ...validEmail, channel: "pigeon" }],
    });

    expect([none.status, repeated.status, unknown.status]).toEqual([400, 400, 400]);
    expect(JSON.stringify(await unknown.json())).toContain("Only the email channel is supported");
  });
});
