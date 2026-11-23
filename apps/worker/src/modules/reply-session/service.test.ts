import { messages, mcpSessions, playbooks, users } from "@leren/db";
import { createTestDatabase } from "@leren/db/testing";
import type { TestDatabase } from "@leren/db/testing";
import { verifySession } from "@leren/mcp-server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { REPLY_SESSION_TTL_SECONDS, closeReplySession, openReplySession } from "./service";

const SECRET = "a-test-secret-that-is-at-least-32-characters";
const NOW = new Date("2026-11-23T10:00:00Z");

describe("the reply session", () => {
  let database: TestDatabase;
  let ownerId: string;
  let otherId: string;
  let messageId: string;
  let ownPlaybookId: string;
  let otherPlaybookId: string;

  const deps = () => ({ db: database.db, secret: SECRET, now: () => NOW });

  const job = (...playbookIds: string[]) => ({
    messageId,
    playbooks: playbookIds.map((playbookId) => ({ playbookId, verdict: "handle" as const })),
  });

  beforeAll(async () => {
    database = await createTestDatabase();

    const [owner, other] = await database.db
      .insert(users)
      .values([{ email: "owner@example.com" }, { email: "other@example.com" }])
      .returning({ id: users.id });

    ownerId = owner?.id ?? "";
    otherId = other?.id ?? "";
  });

  beforeEach(async () => {
    await database.db.delete(mcpSessions);
    await database.db.delete(messages);
    await database.db.delete(playbooks);

    const [message] = await database.db
      .insert(messages)
      .values({
        userId: ownerId,
        channel: "email",
        provider: "mailpit",
        providerMessageId: crypto.randomUUID(),
        fromAddress: "sender@example.com",
        toAddresses: ["owner@example.com"],
        subject: "Hello",
        body: "Body",
        receivedAt: NOW,
      })
      .returning({ id: messages.id });

    const [own, foreign] = await database.db
      .insert(playbooks)
      .values([
        { userId: ownerId, topic: "Own", response: "Reply", timezone: "UTC" },
        { userId: otherId, topic: "Foreign", response: "Reply", timezone: "UTC" },
      ])
      .returning({ id: playbooks.id });

    messageId = message?.id ?? "";
    ownPlaybookId = own?.id ?? "";
    otherPlaybookId = foreign?.id ?? "";
  });

  afterAll(async () => {
    await database.drop();
  });

  it("binds the session to the owner of the message and to the message", async () => {
    const minted = await openReplySession(deps(), job(ownPlaybookId));
    const session = await verifySession(deps(), minted.token);

    expect(session).toMatchObject({
      userId: ownerId,
      role: "reply",
      messageId,
      scopes: ["playbooks:read"],
    });
    expect(minted.expiresAt.getTime() - NOW.getTime()).toBe(REPLY_SESSION_TTL_SECONDS * 1000);
  });

  it("refuses a job whose playbook belongs to another user", async () => {
    await expect(openReplySession(deps(), job(ownPlaybookId, otherPlaybookId))).rejects.toThrow(
      "not the owner's",
    );
  });

  it("opens a session when a playbook of the job was deleted after the gate queued it", async () => {
    await database.db.delete(playbooks).where(eq(playbooks.id, ownPlaybookId));

    const minted = await openReplySession(deps(), job(ownPlaybookId));

    expect(await verifySession(deps(), minted.token)).toMatchObject({ userId: ownerId });
  });

  it("refuses a message that does not exist", async () => {
    await database.db.delete(messages).where(eq(messages.id, messageId));

    await expect(openReplySession(deps(), job(ownPlaybookId))).rejects.toThrow("does not exist");
  });

  it("stops the token from working once the session is closed", async () => {
    const minted = await openReplySession(deps(), job(ownPlaybookId));

    await closeReplySession(deps(), ownerId, minted);

    expect(await verifySession(deps(), minted.token)).toBeNull();
  });
});
