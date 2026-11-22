import { channelAccounts, messages, users } from "@leren/db";
import { createTestDatabase } from "@leren/db/testing";
import type { TestDatabase } from "@leren/db/testing";
import { createInMemoryEmailSender } from "@leren/email/testing";
import type { InMemoryEmailSender } from "@leren/email/testing";
import { recordInboundEmail } from "@leren/inbox";
import type { Logger } from "@leren/logger";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../../app";
import { createAuth } from "../auth/service";

const ORIGIN = "http://localhost:5173";
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

type ListResponse = {
  messages: { id: string; status: string; subject: string; preview: string }[];
  nextCursor: string | null;
};

describe("messages API", () => {
  let database: TestDatabase;
  let sender: InMemoryEmailSender;
  let app: ReturnType<typeof createApp>;
  const publish = vi.fn();

  const post = (path: string, payload: unknown, cookie = "") =>
    app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN, cookie },
      body: JSON.stringify(payload),
    });

  const get = (path: string, cookie: string) => app.request(path, { headers: { cookie } });

  const signIn = async (email: string) => {
    await post("/api/auth/email-otp/send-verification-otp", { email, type: "sign-in" });

    const otp = /\b\d{6}\b/.exec(sender.sent.at(-1)?.text ?? "")?.[0];
    const response = await post("/api/auth/sign-in/email-otp", { email, otp });

    return response.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
  };

  const addAccount = async (email: string) => {
    const [user] = await database.db.select().from(users).where(eq(users.email, email));

    const [account] = await database.db
      .insert(channelAccounts)
      .values({
        userId: user?.id ?? "",
        channel: "email",
        provider: "mailpit",
        providerAccountId: email,
        label: email,
      })
      .returning({ id: channelAccounts.id });

    return { userId: user?.id ?? "", accountId: account?.id ?? "" };
  };

  const addMessage = async (
    owner: { userId: string; accountId: string },
    subject: string,
    receivedAt: string,
  ) => {
    const [row] = await database.db
      .insert(messages)
      .values({
        userId: owner.userId,
        channelAccountId: owner.accountId,
        channel: "email",
        provider: "mailpit",
        providerMessageId: crypto.randomUUID(),
        fromAddress: "sender@example.com",
        subject,
        body: "b".repeat(1000),
        receivedAt: new Date(receivedAt),
      })
      .returning({ id: messages.id });

    return row?.id ?? "";
  };

  beforeAll(async () => {
    database = await createTestDatabase();
    sender = createInMemoryEmailSender();

    const auth = createAuth({
      db: database.db,
      emailSender: sender,
      logger: createSilentLogger(),
      secret: "test-secret-test-secret-test-secret-1234",
      baseURL: "http://localhost:3000",
      trustedOrigins: [ORIGIN],
    });

    app = createApp({
      auth,
      db: database.db,
      logger: createSilentLogger(),
      requestKnowledgeIndex: async () => {},
      inbox: {
        recordEmail: (email) => recordInboundEmail({ db: database.db, queue: { publish } }, email),
        simulate: true,
      },
      mcp: { secret: "an-mcp-test-secret-of-at-least-32-chars" },
    });
  });

  beforeEach(async () => {
    await database.db.delete(messages);
  });

  afterAll(async () => {
    await database.drop();
  });

  it("requires a session", async () => {
    expect((await app.request("/api/messages")).status).toBe(401);
    expect((await app.request(`/api/messages/${MISSING_ID}`)).status).toBe(401);
    expect((await post("/api/messages/simulate", { from: "a@b.co", body: "x" })).status).toBe(401);
  });

  it("lists only the signed-in user's messages, newest first, with a preview", async () => {
    const cookie = await signIn("list-a@example.com");
    const mine = await addAccount("list-a@example.com");

    await signIn("list-b@example.com");

    const theirs = await addAccount("list-b@example.com");

    await addMessage(mine, "older", "2026-11-20T10:00:00Z");
    await addMessage(mine, "newer", "2026-11-21T10:00:00Z");
    await addMessage(theirs, "not mine", "2026-11-22T10:00:00Z");

    const body = (await (await get("/api/messages", cookie)).json()) as ListResponse;

    expect(body.messages.map((message) => message.subject)).toEqual(["newer", "older"]);
    expect(body.messages[0]?.preview).toHaveLength(300);
    expect(body.nextCursor).toBeNull();
  });

  it("filters by status and pages with a cursor", async () => {
    const cookie = await signIn("page@example.com");
    const owner = await addAccount("page@example.com");

    const ids = [
      await addMessage(owner, "one", "2026-11-20T10:00:00Z"),
      await addMessage(owner, "two", "2026-11-21T10:00:00Z"),
      await addMessage(owner, "three", "2026-11-22T10:00:00Z"),
    ];

    await database.db
      .update(messages)
      .set({ status: "failed" })
      .where(eq(messages.id, ids[0] ?? ""));

    const first = (await (await get("/api/messages?limit=2", cookie)).json()) as ListResponse;

    expect(first.messages.map((message) => message.subject)).toEqual(["three", "two"]);
    expect(first.nextCursor).not.toBeNull();

    const second = (await (
      await get(`/api/messages?limit=2&cursor=${first.nextCursor}`, cookie)
    ).json()) as ListResponse;

    expect(second.messages.map((message) => message.subject)).toEqual(["one"]);
    expect(second.nextCursor).toBeNull();

    const failed = (await (
      await get("/api/messages?status=failed", cookie)
    ).json()) as ListResponse;

    expect(failed.messages.map((message) => message.subject)).toEqual(["one"]);
  });

  it("rejects an invalid filter or cursor", async () => {
    const cookie = await signIn("invalid@example.com");

    expect((await get("/api/messages?status=nonsense", cookie)).status).toBe(400);
    expect((await get("/api/messages?cursor=not-a-cursor", cookie)).status).toBe(400);
    expect((await get("/api/messages?limit=1000", cookie)).status).toBe(400);
  });

  it("returns one message with its full body, and not found for another user's", async () => {
    const cookie = await signIn("one-a@example.com");
    const mine = await addAccount("one-a@example.com");

    await signIn("one-b@example.com");

    const theirs = await addAccount("one-b@example.com");
    const ownId = await addMessage(mine, "mine", "2026-11-20T10:00:00Z");
    const otherId = await addMessage(theirs, "theirs", "2026-11-20T10:00:00Z");

    const found = await get(`/api/messages/${ownId}`, cookie);

    expect(found.status).toBe(200);
    expect(((await found.json()) as { body: string }).body).toHaveLength(1000);
    expect((await get(`/api/messages/${otherId}`, cookie)).status).toBe(404);
    expect((await get(`/api/messages/${MISSING_ID}`, cookie)).status).toBe(404);
  });

  it("records a simulated email on the user's development account and publishes it", async () => {
    const cookie = await signIn("sim@example.com");
    const owner = await addAccount("sim@example.com");

    const response = await post(
      "/api/messages/simulate",
      { from: "Boss@Example.com", subject: "Plan", body: "Hello", providerMessageId: "p-1" },
      cookie,
    );

    const { messageId, created } = (await response.json()) as {
      messageId: string;
      created: boolean;
    };

    expect(response.status).toBe(201);
    expect(created).toBe(true);

    const [row] = await database.db.select().from(messages).where(eq(messages.id, messageId));

    expect(row).toMatchObject({
      userId: owner.userId,
      channelAccountId: owner.accountId,
      provider: "mailpit",
      providerMessageId: "p-1",
      fromAddress: "boss@example.com",
      toAddresses: ["sim@example.com"],
      status: "received",
    });

    expect(publish).toHaveBeenCalledOnce();
  });

  it("answers a simulation for a user with no development account with a conflict", async () => {
    const cookie = await signIn("noaccount@example.com");

    const response = await post("/api/messages/simulate", { from: "a@b.co", body: "x" }, cookie);

    expect(response.status).toBe(409);
  });

  it("rejects an invalid simulated email", async () => {
    const cookie = await signIn("badsim@example.com");

    expect((await post("/api/messages/simulate", { body: "x" }, cookie)).status).toBe(400);
  });

  it("does not offer the simulation route when it is turned off", async () => {
    const closed = createApp({
      auth: createAuth({
        db: database.db,
        emailSender: sender,
        logger: createSilentLogger(),
        secret: "test-secret-test-secret-test-secret-1234",
        baseURL: "http://localhost:3000",
        trustedOrigins: [ORIGIN],
      }),
      db: database.db,
      logger: createSilentLogger(),
      requestKnowledgeIndex: async () => {},
      mcp: { secret: "an-mcp-test-secret-of-at-least-32-chars" },
    });

    const cookie = await signIn("closed@example.com");

    await addAccount("closed@example.com");

    const response = await closed.request("/api/messages/simulate", {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN, cookie },
      body: JSON.stringify({ from: "a@b.co", body: "x" }),
    });

    const invalid = await closed.request("/api/messages/simulate", {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN, cookie },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(404);
    expect(invalid.status).toBe(404);
  });

  it("does not split an emoji at the end of the preview", async () => {
    const cookie = await signIn("emoji@example.com");
    const owner = await addAccount("emoji@example.com");
    const id = await addMessage(owner, "emoji", "2026-11-20T10:00:00Z");

    await database.db
      .update(messages)
      .set({ body: `${"a".repeat(299)}😀 tail` })
      .where(eq(messages.id, id));

    const body = (await (await get("/api/messages", cookie)).json()) as ListResponse;

    expect(body.messages[0]?.preview).toBe("a".repeat(299));
  });
});
