import { messages, playbooks, users } from "@leren/db";
import { createTestDatabase } from "@leren/db/testing";
import type { TestDatabase } from "@leren/db/testing";
import { NonRetryableError } from "@leren/queue";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { PIPELINE_ERROR, REPLY_RUN_MAX_ATTEMPTS, createReplyRunJob } from "./job";

const SECRET = "a-test-secret-that-is-at-least-32-characters";

describe("the reply run job", () => {
  let database: TestDatabase;
  let userId: string;
  let messageId: string;
  let playbookId: string;
  const runPipeline = vi.fn();
  const flush = vi.fn(async () => {});

  const run = (attempt: number) =>
    createReplyRunJob({
      db: database.db,
      sessions: { db: database.db, secret: SECRET },
      runPipeline,
      publishDeliver: async () => {},
      observer: { flush },
    }).handler(
      { messageId, playbooks: [{ playbookId, verdict: "handle" }] },
      {
        jobId: "job",
        attempt,
        idempotencyKey: messageId,
        signal: new AbortController().signal,
      },
    );

  const status = async () => {
    const [row] = await database.db.select().from(messages).where(eq(messages.id, messageId));

    return row;
  };

  beforeAll(async () => {
    database = await createTestDatabase();

    const [user] = await database.db
      .insert(users)
      .values({ email: "owner@example.com" })
      .returning({ id: users.id });

    userId = user?.id ?? "";
  });

  beforeEach(async () => {
    runPipeline.mockReset();
    flush.mockClear();
    await database.db.delete(messages);
    await database.db.delete(playbooks);

    const [playbook] = await database.db
      .insert(playbooks)
      .values({ userId, topic: "Topic", response: "Reply", timezone: "UTC" })
      .returning({ id: playbooks.id });

    const [message] = await database.db
      .insert(messages)
      .values({
        userId,
        channel: "email",
        provider: "mailpit",
        providerMessageId: crypto.randomUUID(),
        fromAddress: "sender@example.com",
        toAddresses: ["owner@example.com"],
        subject: "Hello",
        body: "Body",
        receivedAt: new Date(),
        status: "queued",
      })
      .returning({ id: messages.id });

    playbookId = playbook?.id ?? "";
    messageId = message?.id ?? "";
  });

  afterAll(async () => {
    await database.drop();
  });

  it("keeps the message processing when an earlier attempt fails, so that the queue retries it", async () => {
    runPipeline.mockRejectedValue(new Error("The model is unavailable"));

    await expect(run(1)).rejects.toThrow("The model is unavailable");

    expect((await status())?.status).toBe("processing");
  });

  it("marks the message failed when the last attempt fails", async () => {
    runPipeline.mockRejectedValue(new Error("The model is unavailable"));

    await expect(run(REPLY_RUN_MAX_ATTEMPTS)).rejects.toThrow();

    const row = await status();

    expect(row?.status).toBe("failed");
    expect(row?.statusReason).toBe(PIPELINE_ERROR);
  });

  it("marks the message failed at once when the failure cannot succeed on a retry", async () => {
    runPipeline.mockRejectedValue(new NonRetryableError("This job is wrong"));

    await expect(run(1)).rejects.toThrow("This job is wrong");

    expect((await status())?.status).toBe("failed");
  });

  it("delivers the telemetry after every run, and a failed delivery does not fail the job", async () => {
    runPipeline.mockResolvedValue({
      outcome: "escalate",
      citations: [],
      reasons: ["No playbook matches the email reliably."],
      playbooks: [],
      evaluations: [],
      revisions: 0,
    });
    flush.mockRejectedValueOnce(new Error("Lens is down"));

    await expect(run(1)).resolves.toBeUndefined();

    expect(flush).toHaveBeenCalledTimes(1);
    expect((await status())?.status).toBe("escalated");
  });
});
