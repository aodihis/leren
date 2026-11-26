import { channelAccounts, messages, replyDecisions, users } from "@leren/db";
import { createTestDatabase } from "@leren/db/testing";
import type { TestDatabase } from "@leren/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createMessageMcpActions } from "./mcp-actions";

const MISSING_ID = "00000000-0000-4000-8000-000000000000";

type Listed = {
  status: "ok";
  data: {
    messages: { id: string; subject: string; url: string | null }[];
    nextCursor: string | null;
  };
};

function run(
  action: { run: (userId: string, input: never) => Promise<unknown> },
  userId: string,
  input: Record<string, unknown> = {},
) {
  return action.run(userId, input as never);
}

describe("message MCP actions", () => {
  let database: TestDatabase;
  let actions: ReturnType<typeof createMessageMcpActions>;
  let userId: string;
  let otherUserId: string;

  async function seed(email: string) {
    const [user] = await database.db.insert(users).values({ email, name: email }).returning();

    const [account] = await database.db
      .insert(channelAccounts)
      .values({
        userId: user?.id ?? "",
        channel: "email",
        provider: "mailpit",
        providerAccountId: email,
        label: email,
      })
      .returning();

    return { userId: user?.id ?? "", accountId: account?.id ?? "" };
  }

  async function addMessage(
    owner: { userId: string; accountId: string },
    subject: string,
    status: "drafted" | "escalated" | "received",
    receivedAt: string,
  ) {
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
        body: "The full body of the email.",
        status,
        receivedAt: new Date(receivedAt),
      })
      .returning({ id: messages.id });

    return row?.id ?? "";
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    actions = createMessageMcpActions(database.db, "https://app.example.com/");
  });

  afterAll(async () => {
    await database.drop();
  });

  let ownerId: { userId: string; accountId: string };
  let strangerId: { userId: string; accountId: string };

  beforeEach(async () => {
    await database.db.delete(users);

    ownerId = await seed("a@example.com");
    strangerId = await seed("b@example.com");
    userId = ownerId.userId;
    otherUserId = strangerId.userId;
  });

  it("lists only the messages of the session's user, newest first, with a link", async () => {
    const older = await addMessage(ownerId, "Older", "drafted", "2026-11-20T10:00:00Z");
    const newer = await addMessage(ownerId, "Newer", "escalated", "2026-11-21T10:00:00Z");

    await addMessage(strangerId, "Not yours", "drafted", "2026-11-22T10:00:00Z");

    const result = (await run(actions.listMessages, userId)) as Listed;

    expect(result.data.messages.map((message) => message.id)).toEqual([newer, older]);
    expect(result.data.messages[0]?.url).toBe(`https://app.example.com/emails/${newer}`);
    expect(result.data.nextCursor).toBeNull();
  });

  it("filters by status and pages with the cursor", async () => {
    await addMessage(ownerId, "One", "drafted", "2026-11-20T10:00:00Z");
    await addMessage(ownerId, "Two", "drafted", "2026-11-21T10:00:00Z");
    await addMessage(ownerId, "Three", "escalated", "2026-11-22T10:00:00Z");

    const drafted = (await run(actions.listMessages, userId, {
      status: "drafted",
      limit: 1,
    })) as Listed;

    expect(drafted.data.messages.map((message) => message.subject)).toEqual(["Two"]);
    expect(drafted.data.nextCursor).not.toBeNull();

    const next = (await run(actions.listMessages, userId, {
      status: "drafted",
      limit: 1,
      cursor: drafted.data.nextCursor,
    })) as Listed;

    expect(next.data.messages.map((message) => message.subject)).toEqual(["One"]);
  });

  it("accepts a start time with an offset", async () => {
    await addMessage(ownerId, "Early", "drafted", "2026-11-20T01:00:00Z");

    const late = await addMessage(ownerId, "Late", "drafted", "2026-11-20T03:00:00Z");

    const result = (await run(actions.listMessages, userId, {
      since: "2026-11-20T09:00:00+07:00",
    })) as Listed;

    expect(result.data.messages.map((message) => message.id)).toEqual([late]);
  });

  it("rejects a cursor that was not issued by the list", async () => {
    expect(await run(actions.listMessages, userId, { cursor: "garbage" })).toEqual({
      status: "invalid",
      message: "cursor: Invalid cursor",
    });
  });

  it("returns one message with its body and the decision, without the delivery payloads", async () => {
    const id = await addMessage(ownerId, "Hours?", "drafted", "2026-11-20T10:00:00Z");

    await database.db.insert(replyDecisions).values({
      messageId: id,
      userId,
      outcome: "answer",
      body: "We are open 09:00 to 17:00.",
      category: "question",
      citations: [],
      playbookIds: [],
      reasons: [],
      revisions: 0,
      evaluations: [],
    });

    const result = (await run(actions.getMessage, userId, { messageId: id })) as {
      status: string;
      data: Record<string, unknown>;
    };

    expect(result.status).toBe("ok");
    expect(result.data).toMatchObject({
      id,
      body: "The full body of the email.",
      decision: { outcome: "answer", reply: "We are open 09:00 to 17:00." },
    });
    expect(JSON.stringify(result.data)).not.toContain("deliveryRequest");
  });

  it("reports a message of another user, and a missing one, as not found", async () => {
    const foreign = await addMessage(strangerId, "Private", "drafted", "2026-11-20T10:00:00Z");

    expect(await run(actions.getMessage, userId, { messageId: foreign })).toEqual({
      status: "not_found",
    });
    expect(await run(actions.getMessage, userId, { messageId: MISSING_ID })).toEqual({
      status: "not_found",
    });
    expect(otherUserId).not.toBe(userId);
  });
});
