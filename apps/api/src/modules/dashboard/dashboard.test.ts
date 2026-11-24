import { channelAccounts, messages, playbooks, replyDecisions, users } from "@leren/db";
import { createTestDatabase } from "@leren/db/testing";
import type { TestDatabase } from "@leren/db/testing";
import { createInMemoryEmailSender } from "@leren/email/testing";
import type { InMemoryEmailSender } from "@leren/email/testing";
import type { Logger } from "@leren/logger";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../../app";
import { createAuth } from "../auth/service";

const ORIGIN = "http://localhost:5173";
const MISSING_ID = "00000000-0000-4000-8000-000000000000";
const DAY = 24 * 60 * 60 * 1000;

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

type Owner = { userId: string; accountId: string };

type Decision = Partial<typeof replyDecisions.$inferInsert> & {
  outcome: typeof replyDecisions.$inferInsert.outcome;
};

describe("dashboard API", () => {
  let database: TestDatabase;
  let sender: InMemoryEmailSender;
  let app: ReturnType<typeof createApp>;

  const post = (path: string, payload: unknown) =>
    app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify(payload),
    });

  const get = (path: string, cookie = "") => app.request(path, { headers: { cookie } });

  const signIn = async (email: string) => {
    await post("/api/auth/email-otp/send-verification-otp", { email, type: "sign-in" });

    const otp = /\b\d{6}\b/.exec(sender.sent.at(-1)?.text ?? "")?.[0];
    const response = await post("/api/auth/sign-in/email-otp", { email, otp });

    return response.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
  };

  const addOwner = async (email: string): Promise<Owner> => {
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
    owner: Owner,
    receivedAt: Date,
    status: typeof messages.$inferInsert.status = "received",
    decision?: Decision,
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
        subject: "subject",
        body: "body",
        receivedAt,
        status,
      })
      .returning({ id: messages.id });

    if (decision) {
      const started = decision.deliveryState && decision.deliveryState !== "pending";

      await database.db.insert(replyDecisions).values({
        messageId: row?.id ?? "",
        userId: owner.userId,
        deliveryRequest: started ? {} : null,
        deliveryStartedAt: started ? receivedAt : null,
        ...decision,
      });
    }

    return row?.id ?? "";
  };

  const addPlaybook = async (owner: Owner, period: { startsAt?: Date; endsAt?: Date }) => {
    const [row] = await database.db
      .insert(playbooks)
      .values({
        userId: owner.userId,
        topic: "Vacation",
        information: "I am away.",
        timezone: "UTC",
        ...period,
      })
      .returning({ id: playbooks.id });

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
      mcp: { secret: "an-mcp-test-secret-of-at-least-32-chars" },
    });
  });

  beforeEach(async () => {
    await database.db.delete(messages);
    await database.db.delete(playbooks);
  });

  afterAll(async () => {
    await database.drop();
  });

  it("requires a session", async () => {
    expect((await get("/api/dashboard/overview")).status).toBe(401);
    expect((await get(`/api/dashboard/playbooks/${MISSING_ID}/report`)).status).toBe(401);
  });

  it("counts the messages of the window by status, outcome and delivery state", async () => {
    const cookie = await signIn("overview@example.com");
    const owner = await addOwner("overview@example.com");

    await signIn("overview-other@example.com");

    const other = await addOwner("overview-other@example.com");
    const now = Date.now();

    await addMessage(owner, new Date(now - DAY), "sent", {
      outcome: "answer",
      deliveryMode: "send",
      deliveryState: "completed",
      sentMessageId: "sent-1",
    });
    await addMessage(owner, new Date(now - 2 * DAY), "escalated", { outcome: "escalate" });
    await addMessage(owner, new Date(now - 3 * DAY), "received");
    await addMessage(owner, new Date(now - 60 * DAY), "sent", { outcome: "answer" });
    await addMessage(other, new Date(now - DAY), "failed");

    const response = await get("/api/dashboard/overview?days=30", cookie);
    const body = await response.json();

    expect(response.status).toBe(200);

    expect(body).toMatchObject({
      days: 30,
      total: 3,
      byStatus: { sent: 1, escalated: 1, received: 1 },
      byOutcome: { answer: 1, escalate: 1 },
      byDeliveryState: { completed: 1 },
      failures: [],
    });
  });

  it("lists a failed message and a failed delivery as failures, newest first", async () => {
    const cookie = await signIn("failures@example.com");
    const owner = await addOwner("failures@example.com");
    const now = Date.now();

    const failedMessage = await addMessage(owner, new Date(now - 2 * DAY), "failed");

    const failedDelivery = await addMessage(owner, new Date(now - DAY), "drafted", {
      outcome: "answer",
      deliveryMode: "draft",
      deliveryState: "failed",
      deliveryError: "quota",
    });

    await addMessage(owner, new Date(now - 3 * DAY), "sent", { outcome: "answer" });

    const body = await (await get("/api/dashboard/overview", cookie)).json();

    expect(body.failures.map((failure: { id: string }) => failure.id)).toEqual([
      failedDelivery,
      failedMessage,
    ]);

    expect(body.failures[0]).toMatchObject({ deliveryState: "failed", deliveryError: "quota" });
  });

  it("rejects a window that is out of range", async () => {
    const cookie = await signIn("range@example.com");

    expect((await get("/api/dashboard/overview?days=0", cookie)).status).toBe(400);
    expect((await get("/api/dashboard/overview?days=366", cookie)).status).toBe(400);
  });

  it("reports on a playbook whose period has ended", async () => {
    const cookie = await signIn("report@example.com");
    const owner = await addOwner("report@example.com");
    const now = Date.now();
    const startsAt = new Date(now - 10 * DAY);
    const endsAt = new Date(now - 5 * DAY);
    const id = await addPlaybook(owner, { startsAt, endsAt });
    const other = await addPlaybook(owner, {});

    await addMessage(owner, new Date(now - 8 * DAY), "sent", {
      outcome: "answer",
      playbookIds: [id],
      citations: [id],
      deliveryMode: "send",
      deliveryState: "completed",
      sentMessageId: "sent-1",
    });
    await addMessage(owner, new Date(now - 7 * DAY), "escalated", {
      outcome: "escalate",
      playbookIds: [id],
    });
    await addMessage(owner, new Date(now - 6 * DAY), "sent", {
      outcome: "answer",
      playbookIds: [other],
    });
    await addMessage(owner, new Date(now - 2 * DAY), "sent", {
      outcome: "answer",
      playbookIds: [id],
    });
    await addMessage(owner, new Date(now - 11 * DAY), "sent", {
      outcome: "answer",
      playbookIds: [id],
    });

    const response = await get(`/api/dashboard/playbooks/${id}/report`, cookie);

    expect(response.status).toBe(200);

    expect(await response.json()).toMatchObject({
      playbook: { id, topic: "Vacation", timezone: "UTC" },
      total: 2,
      cited: 1,
      byOutcome: { answer: 1, escalate: 1 },
      byDeliveryState: { completed: 1 },
    });
  });

  it("does not report on a playbook whose period has not ended", async () => {
    const cookie = await signIn("open@example.com");
    const owner = await addOwner("open@example.com");

    const future = await addPlaybook(owner, { endsAt: new Date(Date.now() + DAY) });
    const unbounded = await addPlaybook(owner, {});

    for (const id of [future, unbounded]) {
      const response = await get(`/api/dashboard/playbooks/${id}/report`, cookie);

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: "period_not_ended" });
    }
  });

  it("reports a playbook of another user or a missing playbook as not found", async () => {
    const cookie = await signIn("scope@example.com");

    await signIn("scope-other@example.com");

    const other = await addOwner("scope-other@example.com");
    const theirs = await addPlaybook(other, { endsAt: new Date(Date.now() - DAY) });

    expect((await get(`/api/dashboard/playbooks/${theirs}/report`, cookie)).status).toBe(404);
    expect((await get(`/api/dashboard/playbooks/${MISSING_ID}/report`, cookie)).status).toBe(404);
    expect((await get("/api/dashboard/playbooks/not-a-uuid/report", cookie)).status).toBe(400);
  });
});
