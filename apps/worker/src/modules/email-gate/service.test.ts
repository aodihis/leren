import { channelAccounts, messages, playbooks, replyConditions, users } from "@leren/db";
import { createTestDatabase } from "@leren/db/testing";
import type { TestDatabase } from "@leren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { gateMessage } from "./service";

const NOW = new Date("2026-11-22T12:00:00Z");

const OPEN_CONDITIONS = {
  senderMode: "any",
  senderAllowlist: [],
  replyWhenTo: true,
  replyWhenCc: false,
  replyWhenBcc: false,
  requireSoleRecipient: false,
  mentionOverrides: false,
  mentionDetection: "alias",
  mentionAliases: [],
  threadMode: "both",
  skipBulkMail: true,
  replyMode: "draft",
};

describe("the email gate", () => {
  let database: TestDatabase;
  let userId: string;
  let accountId: string;
  const publishProcess = vi.fn();

  const gate = (messageId: string) =>
    gateMessage({ db: database.db, publishProcess }, messageId, NOW);

  const addMessage = async (overrides: Partial<typeof messages.$inferInsert> = {}) => {
    const [row] = await database.db
      .insert(messages)
      .values({
        userId,
        channelAccountId: accountId,
        channel: "email",
        provider: "mailpit",
        providerMessageId: crypto.randomUUID(),
        fromAddress: "sender@example.com",
        toAddresses: ["me@example.com"],
        subject: "Hello",
        body: "Body",
        receivedAt: NOW,
        ...overrides,
      })
      .returning({ id: messages.id });

    return row?.id ?? "";
  };

  const addPlaybook = async (
    playbook: Partial<typeof playbooks.$inferInsert> = {},
    settings: Record<string, unknown> = {},
    channelAccountId: string | null = accountId,
  ) => {
    const [row] = await database.db
      .insert(playbooks)
      .values({ userId, topic: "Topic", information: "Reply", timezone: "UTC", ...playbook })
      .returning({ id: playbooks.id });

    await database.db.insert(replyConditions).values({
      playbookId: row?.id ?? "",
      channel: "email",
      channelAccountId,
      settings: { ...OPEN_CONDITIONS, ...settings },
    });

    return row?.id ?? "";
  };

  const stored = async (messageId: string) => {
    const [row] = await database.db.select().from(messages).where(eq(messages.id, messageId));

    return row;
  };

  beforeAll(async () => {
    database = await createTestDatabase();

    const [user] = await database.db
      .insert(users)
      .values({ email: "me@example.com", firstName: "Dana", lastName: "Wu" })
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
    await database.db.delete(playbooks);
    await database.db
      .update(channelAccounts)
      .set({ status: "active" })
      .where(eq(channelAccounts.id, accountId));
  });

  afterAll(async () => {
    await database.drop();
  });

  it("queues a message that a usable playbook handles and publishes it to the pipeline", async () => {
    const messageId = await addMessage();
    const playbookId = await addPlaybook();

    expect(await gate(messageId)).toBe("queued");
    expect((await stored(messageId))?.status).toBe("queued");

    expect(publishProcess).toHaveBeenCalledExactlyOnceWith({
      messageId,
      playbooks: [{ playbookId, verdict: "handle" }],
    });
  });

  it("deletes a message when the user has no usable playbook", async () => {
    const messageId = await addMessage();

    await addPlaybook({ enabled: false });
    await addPlaybook({ endsAt: new Date("2026-11-01T00:00:00Z") });
    await addPlaybook({ startsAt: new Date("2026-12-01T00:00:00Z") });

    expect(await gate(messageId)).toBe("deleted");
    expect(await stored(messageId)).toBeUndefined();
    expect(publishProcess).not.toHaveBeenCalled();
  });

  it("deletes a message that the conditions skip", async () => {
    const messageId = await addMessage({ isBulk: true });

    await addPlaybook();

    expect(await gate(messageId)).toBe("deleted");
    expect(await stored(messageId)).toBeUndefined();
  });

  it("ignores a playbook that listens on another account or none", async () => {
    const messageId = await addMessage();

    await addPlaybook({}, {}, null);

    expect(await gate(messageId)).toBe("deleted");
    expect(await stored(messageId)).toBeUndefined();
  });

  it("ignores a playbook of another user", async () => {
    const [other] = await database.db
      .insert(users)
      .values({ email: "other@example.com" })
      .returning({ id: users.id });

    const messageId = await addMessage();

    const [foreign] = await database.db
      .insert(playbooks)
      .values({ userId: other?.id ?? "", topic: "T", information: "R", timezone: "UTC" })
      .returning({ id: playbooks.id });

    await database.db.insert(replyConditions).values({
      playbookId: foreign?.id ?? "",
      channel: "email",
      channelAccountId: accountId,
      settings: OPEN_CONDITIONS,
    });

    expect(await gate(messageId)).toBe("deleted");
    expect(await stored(messageId)).toBeUndefined();
  });

  it("passes a message that needs a mention check to the pipeline with that verdict", async () => {
    const messageId = await addMessage({ toAddresses: ["team@example.com"] });

    const playbookId = await addPlaybook(
      {},
      { mentionOverrides: true, mentionDetection: "alias_then_llm" },
    );

    expect(await gate(messageId)).toBe("queued");
    expect(publishProcess).toHaveBeenCalledWith({
      messageId,
      playbooks: [{ playbookId, verdict: "check_mention" }],
    });
  });

  it("matches a mention of the user's first name", async () => {
    const messageId = await addMessage({
      toAddresses: ["team@example.com"],
      body: "Dana, can you answer this?",
    });

    await addPlaybook({}, { mentionOverrides: true });

    expect(await gate(messageId)).toBe("queued");
  });

  it("does not evaluate a playbook whose stored settings are invalid", async () => {
    const messageId = await addMessage();

    await addPlaybook({}, { senderMode: "nobody" });

    expect(await gate(messageId)).toBe("deleted");
    expect(await stored(messageId)).toBeUndefined();
  });

  it("deletes a message when the account is revoked", async () => {
    const messageId = await addMessage();

    await addPlaybook();
    await database.db
      .update(channelAccounts)
      .set({ status: "revoked" })
      .where(eq(channelAccounts.id, accountId));

    expect(await gate(messageId)).toBe("deleted");
    expect(await stored(messageId)).toBeUndefined();
  });

  it("deletes a message when the account was deleted", async () => {
    const messageId = await addMessage({ channelAccountId: null });

    await addPlaybook();

    expect(await gate(messageId)).toBe("deleted");
    expect(await stored(messageId)).toBeUndefined();
  });

  it("deletes a message sent from another of the user's own accounts", async () => {
    await database.db.insert(channelAccounts).values({
      userId,
      channel: "email",
      provider: "mailpit",
      providerAccountId: "shared@example.com",
      label: "Shared@example.com",
    });

    const messageId = await addMessage({ fromAddress: "shared@example.com" });

    await addPlaybook();

    expect(await gate(messageId)).toBe("deleted");
    expect(await stored(messageId)).toBeUndefined();
    expect(publishProcess).not.toHaveBeenCalled();

    await database.db
      .delete(channelAccounts)
      .where(eq(channelAccounts.providerAccountId, "shared@example.com"));
  });

  it("does nothing for a record that has left the gate or does not exist", async () => {
    const messageId = await addMessage({ status: "processing" });

    await addPlaybook();

    expect(await gate(messageId)).toBe("ignored");
    expect(await gate("00000000-0000-4000-8000-000000000000")).toBe("ignored");
    expect((await stored(messageId))?.status).toBe("processing");
    expect(publishProcess).not.toHaveBeenCalled();
  });

  it("does not delete a queued record that no playbook handles any more", async () => {
    const messageId = await addMessage({ status: "queued" });

    await addPlaybook({ enabled: false });

    expect(await gate(messageId)).toBe("ignored");
    expect((await stored(messageId))?.status).toBe("queued");
    expect(publishProcess).not.toHaveBeenCalled();
  });

  it("publishes a queued record again, which repairs a lost publish", async () => {
    const messageId = await addMessage({ status: "queued" });

    await addPlaybook();

    expect(await gate(messageId)).toBe("queued");
    expect(publishProcess).toHaveBeenCalledOnce();
  });
});
