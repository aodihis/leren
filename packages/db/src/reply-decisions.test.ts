import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { messages, replyDecisions, users } from "./schema";
import { createTestDatabase } from "./testing";
import type { TestDatabase } from "./testing";

describe("the delivery record of a reply decision (decision 0046)", () => {
  let database: TestDatabase;
  let decisionId: string;

  beforeAll(async () => {
    database = await createTestDatabase();

    const [user] = await database.db
      .insert(users)
      .values({ email: "owner@example.com" })
      .returning({ id: users.id });

    const [message] = await database.db
      .insert(messages)
      .values({
        userId: user?.id ?? "",
        channel: "email",
        provider: "google",
        providerMessageId: "m1",
        fromAddress: "sender@example.com",
        subject: "Hello",
        body: "Body",
        receivedAt: new Date(),
        status: "drafted",
      })
      .returning({ id: messages.id });

    const [decision] = await database.db
      .insert(replyDecisions)
      .values({
        messageId: message?.id ?? "",
        userId: user?.id ?? "",
        outcome: "answer",
        body: "The deadline is Friday.",
      })
      .returning({ id: replyDecisions.id });

    decisionId = decision?.id ?? "";
  });

  afterAll(async () => {
    await database.drop();
  });

  const read = async () => {
    const [row] = await database.db
      .select()
      .from(replyDecisions)
      .where(eq(replyDecisions.id, decisionId));

    return row;
  };

  const lose = (changes: Partial<typeof replyDecisions.$inferInsert>) =>
    database.db.update(replyDecisions).set(changes).where(eq(replyDecisions.id, decisionId));

  it("starts with no delivery recorded", async () => {
    expect(await read()).toMatchObject({
      deliveryMode: null,
      deliveryState: null,
      deliveryRequest: null,
      deliveryResponse: null,
      deliveryAttempts: 0,
      deliveryStartedAt: null,
      mailboxDraftId: null,
      sentMessageId: null,
      deliveryError: null,
    });
  });

  it("keeps the request before the call and the response after it", async () => {
    const request = {
      to: "sender@example.com",
      subject: "Re: Hello",
      body: "The deadline is Friday.",
    };

    const startedAt = new Date("2026-11-23T10:00:00Z");

    await database.db
      .update(replyDecisions)
      .set({
        deliveryMode: "draft",
        deliveryState: "started",
        deliveryRequest: request,
        deliveryAttempts: 1,
        deliveryStartedAt: startedAt,
      })
      .where(eq(replyDecisions.id, decisionId));

    expect(await read()).toMatchObject({
      deliveryState: "started",
      deliveryRequest: request,
      deliveryResponse: null,
      deliveryAttempts: 1,
      deliveryStartedAt: startedAt,
    });

    const response = { id: "draft-1", message: { id: "msg-1", threadId: "thread-1" } };

    await database.db
      .update(replyDecisions)
      .set({
        deliveryState: "completed",
        deliveryResponse: response,
        mailboxDraftId: "draft-1",
        deliveryFinishedAt: new Date("2026-11-23T10:00:02Z"),
      })
      .where(eq(replyDecisions.id, decisionId));

    expect(await read()).toMatchObject({
      deliveryMode: "draft",
      deliveryState: "completed",
      deliveryRequest: request,
      deliveryResponse: response,
      mailboxDraftId: "draft-1",
    });
  });

  it("refuses a record that would lose what is needed to investigate a delivery", async () => {
    await expect(lose({ deliveryMode: null })).rejects.toThrow();
    await expect(lose({ deliveryRequest: null })).rejects.toThrow();
    await expect(lose({ deliveryStartedAt: null })).rejects.toThrow();
    await expect(lose({ mailboxDraftId: null })).rejects.toThrow();

    expect(await read()).toMatchObject({ deliveryState: "completed", mailboxDraftId: "draft-1" });
  });

  it("accepts a delivery that failed before the call without a request", async () => {
    await database.db
      .update(replyDecisions)
      .set({
        deliveryState: "failed",
        deliveryRequest: null,
        deliveryStartedAt: null,
        mailboxDraftId: null,
        deliveryError: "The original is bulk mail",
      })
      .where(eq(replyDecisions.id, decisionId));

    expect(await read()).toMatchObject({
      deliveryState: "failed",
      deliveryError: "The original is bulk mail",
    });
  });

  it("refuses a delivery state or a mode that is not defined", async () => {
    await expect(
      database.db
        .update(replyDecisions)
        .set({ deliveryState: "maybe" as never })
        .where(eq(replyDecisions.id, decisionId)),
    ).rejects.toThrow();

    await expect(
      database.db
        .update(replyDecisions)
        .set({ deliveryMode: "post" as never })
        .where(eq(replyDecisions.id, decisionId)),
    ).rejects.toThrow();
  });
});
