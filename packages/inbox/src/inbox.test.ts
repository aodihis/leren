import { channelAccounts, messages, users } from "@leren/db";
import { createTestDatabase } from "@leren/db/testing";
import type { TestDatabase } from "@leren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { EMAIL_RECEIVED_QUEUE, MESSAGE_BODY_LIMIT, recordInboundEmail, truncate } from "./record";
import type { InboundEmail } from "./record";
import { canTransition, redactMessageText, transitionMessage } from "./status";

describe("truncate", () => {
  it("keeps text that fits", () => {
    expect(truncate("abc", 3)).toEqual({ text: "abc", truncated: false });
  });

  it("cuts text that is too long and says so", () => {
    expect(truncate("abcdef", 3)).toEqual({ text: "abc", truncated: true });
  });

  it("does not split a surrogate pair", () => {
    expect(truncate("ab😀cd", 3)).toEqual({ text: "ab", truncated: true });
  });
});

describe("canTransition", () => {
  it.each([
    ["received", "queued", true],
    ["received", "not_applicable", true],
    ["queued", "processing", true],
    ["processing", "drafted", true],
    ["drafted", "sent", true],
    ["drafted", "failed", true],
    ["drafted", "processing", false],
    ["drafted", "escalated", false],
    ["failed", "drafted", false],
    ["queued", "received", false],
    ["processing", "queued", false],
    ["not_applicable", "queued", false],
    ["sent", "failed", false],
  ] as const)("%s to %s is %s", (from, to, allowed) => {
    expect(canTransition(from, to)).toBe(allowed);
  });
});

describe("the message record", () => {
  let database: TestDatabase;
  let userId: string;
  let accountId: string;
  const publish = vi.fn();

  const email = (overrides: Partial<InboundEmail> = {}): InboundEmail => ({
    userId,
    channelAccountId: accountId,
    channel: "email",
    provider: "mailpit",
    providerMessageId: "provider-1",
    from: "sender@example.com",
    to: ["me@example.com"],
    subject: "Hello",
    body: "Body",
    receivedAt: new Date("2026-11-22T10:00:00Z"),
    ...overrides,
  });

  const record = (overrides?: Partial<InboundEmail>) =>
    recordInboundEmail({ db: database.db, queue: { publish } }, email(overrides));

  beforeAll(async () => {
    database = await createTestDatabase();

    const [user] = await database.db
      .insert(users)
      .values({ email: "me@example.com" })
      .returning({ id: users.id });

    userId = user?.id ?? "";

    const [account] = await database.db
      .insert(channelAccounts)
      .values({
        userId,
        channel: "email",
        provider: "mailpit",
        providerAccountId: "me@example.com",
        label: "me@example.com",
      })
      .returning({ id: channelAccounts.id });

    accountId = account?.id ?? "";
  });

  beforeEach(async () => {
    await database.db.delete(messages);
  });

  afterAll(async () => {
    await database.drop();
  });

  it("stores the email data and publishes the record to the gate", async () => {
    const result = await record({ providerThreadId: "thread-1", cc: ["cc@example.com"] });

    const [row] = await database.db
      .select()
      .from(messages)
      .where(eq(messages.id, result.messageId));

    expect(result.created).toBe(true);

    expect(row).toMatchObject({
      status: "received",
      providerMessageId: "provider-1",
      providerThreadId: "thread-1",
      channel: "email",
      fromAddress: "sender@example.com",
      ccAddresses: ["cc@example.com"],
      bodyTruncated: false,
    });

    expect(publish).toHaveBeenCalledExactlyOnceWith(
      EMAIL_RECEIVED_QUEUE,
      { messageId: result.messageId },
      { idempotencyKey: result.messageId },
    );
  });

  it("cuts a body that is too long and flags it", async () => {
    const result = await record({ body: "x".repeat(MESSAGE_BODY_LIMIT + 10) });

    const [row] = await database.db
      .select()
      .from(messages)
      .where(eq(messages.id, result.messageId));

    expect(row?.body).toHaveLength(MESSAGE_BODY_LIMIT);
    expect(row?.bodyTruncated).toBe(true);
  });

  it("records an email that is delivered twice once, and publishes it again while it is received", async () => {
    const first = await record();
    const second = await record();

    expect(second).toEqual({ messageId: first.messageId, created: false });
    expect(await database.db.select().from(messages)).toHaveLength(1);
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it("does not publish a duplicate whose record has left the received status", async () => {
    const first = await record();

    await transitionMessage(database.db, first.messageId, "queued");
    publish.mockClear();

    await record();

    expect(publish).not.toHaveBeenCalled();
  });

  it("treats the same provider id of another user as another message", async () => {
    const [other] = await database.db
      .insert(users)
      .values({ email: "other@example.com" })
      .returning({ id: users.id });

    await record();
    await record({ userId: other?.id ?? "" });

    expect(await database.db.select().from(messages)).toHaveLength(2);
  });

  it("moves only from the statuses that the caller allows", async () => {
    const { messageId } = await record();

    await transitionMessage(database.db, messageId, "queued");
    await transitionMessage(database.db, messageId, "processing");
    await transitionMessage(database.db, messageId, "drafted");

    expect(
      await transitionMessage(database.db, messageId, "failed", null, ["queued", "processing"]),
    ).toBe(false);
    expect(await transitionMessage(database.db, messageId, "failed", null, ["drafted"])).toBe(true);
  });

  it("moves a status forward once, and never backwards", async () => {
    const { messageId } = await record();

    expect(await transitionMessage(database.db, messageId, "queued")).toBe(true);
    expect(await transitionMessage(database.db, messageId, "queued")).toBe(false);
    expect(await transitionMessage(database.db, messageId, "processing")).toBe(true);
    expect(await transitionMessage(database.db, messageId, "failed", "boom")).toBe(true);
    expect(await transitionMessage(database.db, messageId, "queued")).toBe(false);

    const [row] = await database.db.select().from(messages).where(eq(messages.id, messageId));

    expect(row).toMatchObject({ status: "failed", statusReason: "boom" });
  });

  const stored = async (messageId: string) => {
    const [row] = await database.db.select().from(messages).where(eq(messages.id, messageId));

    return row;
  };

  describe("redaction of the text", () => {
    const personal = {
      subject: "Call me on +62 812 3456 7890",
      body: "Write to jane.doe@example.org or call +62 812 3456 7890.",
    };

    it("redacts the subject and the body, and keeps the addresses, when a message ends", async () => {
      const { messageId } = await record({ ...personal, providerMessageId: "redact-1" });

      await transitionMessage(database.db, messageId, "queued");
      await transitionMessage(database.db, messageId, "processing");
      await transitionMessage(database.db, messageId, "escalated", "No match");

      expect(await stored(messageId)).toMatchObject({
        subject: "Call me on [redacted]",
        body: "Write to [redacted] or call [redacted].",
        fromAddress: "sender@example.com",
        toAddresses: ["me@example.com"],
      });
    });

    it("keeps order numbers, dates and amounts in the stored text", async () => {
      const { messageId } = await record({
        subject: "Refund for order 1234567890",
        body: "Invoice INV-2026-11-0042, meeting on 2026-11-26 10:00, total 1.250.000.000.",
        providerMessageId: "redact-3",
      });

      await transitionMessage(database.db, messageId, "queued");
      await transitionMessage(database.db, messageId, "processing");
      await transitionMessage(database.db, messageId, "escalated", "No match");

      expect(await stored(messageId)).toMatchObject({
        subject: "Refund for order 1234567890",
        body: "Invoice INV-2026-11-0042, meeting on 2026-11-26 10:00, total 1.250.000.000.",
      });
    });

    it("keeps the text of a drafted message until the delivery ends", async () => {
      const { messageId } = await record({ ...personal, providerMessageId: "redact-2" });

      await transitionMessage(database.db, messageId, "queued");
      await transitionMessage(database.db, messageId, "processing");
      await transitionMessage(database.db, messageId, "drafted");

      expect((await stored(messageId))?.body).toContain("jane.doe@example.org");

      await redactMessageText(database.db, messageId);

      expect((await stored(messageId))?.body).toBe("Write to [redacted] or call [redacted].");
    });
  });
});
