import {
  channelAccounts,
  mcpSessions,
  messages,
  playbooks,
  replyConditions,
  replyDecisions,
  users,
} from "@leren/db";
import { createTestDatabase } from "@leren/db/testing";
import type { TestDatabase } from "@leren/db/testing";
import type { ReplyResult } from "@leren/reply-agent";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { NOT_ADDRESSED, processMessage } from "./service";
import type { PipelineRun } from "./service";

const SECRET = "a-test-secret-that-is-at-least-32-characters";
const NOW = new Date("2026-11-23T10:00:00Z");

const answer: ReplyResult = {
  outcome: "answer",
  body: "The deadline is Friday.",
  citations: ["p1"],
  reasons: [],
  triage: {
    category: "project_question",
    questions: ["When?"],
    injectionSuspected: false,
    addressesUser: true,
    confidence: 0.9,
  },
  playbooks: [{ id: "p1", topic: "Deadline", information: "Friday." }],
  evaluations: [{ stage: "content", pass: true, issues: [] }],
  revisions: 0,
};

const used = (...ids: string[]): ReplyResult => ({
  ...answer,
  playbooks: ids.map((id) => ({ id, topic: "Topic", information: "Reply." })),
});

describe("processMessage", () => {
  let database: TestDatabase;
  let userId: string;
  let accountId: string;
  let playbookId: string;
  let messageId: string;
  const runPipeline = vi.fn<(run: PipelineRun) => Promise<ReplyResult>>();
  const publishDeliver = vi.fn(async (_message: { messageId: string }) => {});
  const signal = new AbortController().signal;

  const job = (verdict: "handle" | "check_mention" = "handle") => ({
    messageId,
    playbooks: [{ playbookId, verdict }],
  });

  const process = (verdict?: "handle" | "check_mention") =>
    processMessage(
      {
        db: database.db,
        sessions: { db: database.db, secret: SECRET, now: () => NOW },
        runPipeline,
        publishDeliver,
      },
      job(verdict),
      signal,
    );

  const stored = async () => {
    const [row] = await database.db.select().from(messages).where(eq(messages.id, messageId));

    return row;
  };

  const decisions = () =>
    database.db.select().from(replyDecisions).where(eq(replyDecisions.messageId, messageId));

  const restart = async () => {
    await database.db.delete(replyDecisions);
    await database.db.update(messages).set({ status: "queued" }).where(eq(messages.id, messageId));
  };

  const deliveryOf = async () => {
    const [decision] = await decisions();

    return { mode: decision?.deliveryMode, state: decision?.deliveryState };
  };

  const setMode = (id: string, replyMode: "draft" | "send") =>
    database.db.insert(replyConditions).values({
      playbookId: id,
      channel: "email",
      channelAccountId: accountId,
      settings: { replyMode },
    });

  const addPlaybook = async (mode: "draft" | "send" | null) => {
    const [playbook] = await database.db
      .insert(playbooks)
      .values({ userId, topic: "Other", information: "Reply.", timezone: "UTC" })
      .returning({ id: playbooks.id });

    if (mode) {
      await setMode(playbook?.id ?? "", mode);
    }

    return playbook?.id ?? "";
  };

  const insertMessage = async (status: "queued" | "processing" | "drafted" = "queued") => {
    const [row] = await database.db
      .insert(messages)
      .values({
        userId,
        channel: "email",
        provider: "mailpit",
        channelAccountId: accountId,
        providerMessageId: crypto.randomUUID(),
        fromAddress: "sender@example.com",
        toAddresses: ["owner@example.com"],
        subject: "Deadline",
        body: "When is the deadline?",
        receivedAt: NOW,
        status,
      })
      .returning({ id: messages.id });

    messageId = row?.id ?? "";
  };

  beforeAll(async () => {
    database = await createTestDatabase();

    const [user] = await database.db
      .insert(users)
      .values({ email: "owner@example.com" })
      .returning({ id: users.id });

    userId = user?.id ?? "";

    const [account] = await database.db
      .insert(channelAccounts)
      .values({
        userId,
        channel: "email",
        provider: "mailpit",
        providerAccountId: "owner@example.com",
        label: "owner@example.com",
      })
      .returning({ id: channelAccounts.id });

    accountId = account?.id ?? "";
  });

  beforeEach(async () => {
    runPipeline.mockReset();
    publishDeliver.mockClear();
    await database.db.delete(mcpSessions);
    await database.db.delete(replyDecisions);
    await database.db.delete(messages);
    await database.db.delete(playbooks);

    const [playbook] = await database.db
      .insert(playbooks)
      .values({ userId, topic: "Deadline", information: "Friday.", timezone: "UTC" })
      .returning({ id: playbooks.id });

    playbookId = playbook?.id ?? "";
    await insertMessage();
  });

  afterAll(async () => {
    await database.drop();
  });

  it("saves the decision and moves an answer to drafted", async () => {
    runPipeline.mockResolvedValue(answer);

    expect(await process()).toBe("processed");

    const [decision] = await decisions();

    expect(decision).toMatchObject({
      userId,
      outcome: "answer",
      body: "The deadline is Friday.",
      citations: ["p1"],
      playbookIds: ["p1"],
      category: "project_question",
    });
    expect((await stored())?.status).toBe("drafted");
  });

  it("gives the pipeline the email, the gate's playbooks and a session of the owner", async () => {
    runPipeline.mockResolvedValue(answer);

    await process();

    const run = runPipeline.mock.calls[0]?.[0];

    expect(run?.input).toMatchObject({
      messageId,
      email: { from: "sender@example.com", subject: "Deadline", body: "When is the deadline?" },
      checkMention: false,
    });
    expect([...(run?.allowedPlaybookIds ?? [])]).toEqual([playbookId]);
    expect(run?.token).toEqual(expect.any(String));
  });

  it("asks for a mention check only when every playbook of the job asks for it", async () => {
    runPipeline.mockResolvedValue(answer);

    await process("check_mention");

    expect(runPipeline.mock.calls[0]?.[0].input.checkMention).toBe(true);
  });

  it("moves an escalation to escalated with the first reason", async () => {
    runPipeline.mockResolvedValue({
      ...answer,
      outcome: "escalate",
      body: undefined,
      citations: [],
      reasons: ["No playbook matches the email reliably."],
    });

    await process();

    const row = await stored();

    expect(row?.status).toBe("escalated");
    expect(row?.statusReason).toBe("No playbook matches the email reliably.");
    expect((await decisions())[0]?.body).toBeNull();
  });

  it("moves a message that is not for the user to not applicable", async () => {
    runPipeline.mockResolvedValue({ ...answer, outcome: "ignore", body: undefined, citations: [] });

    await process();

    const row = await stored();

    expect(row?.status).toBe("not_applicable");
    expect(row?.statusReason).toBe(NOT_ADDRESSED);
  });

  it("does nothing for a message that has left the pipeline", async () => {
    await database.db.update(messages).set({ status: "drafted" }).where(eq(messages.id, messageId));

    expect(await process()).toBe("ignored");
    expect(runPipeline).not.toHaveBeenCalled();
    expect(await decisions()).toHaveLength(0);
  });

  it("does nothing for a message that does not exist", async () => {
    await database.db.delete(messages).where(eq(messages.id, messageId));

    expect(await process()).toBe("ignored");
    expect(runPipeline).not.toHaveBeenCalled();
  });

  it("finishes a message whose decision was saved before a crash without running again", async () => {
    runPipeline.mockResolvedValue(answer);
    await process();
    await database.db
      .update(messages)
      .set({ status: "processing" })
      .where(eq(messages.id, messageId));
    runPipeline.mockClear();

    expect(await process()).toBe("processed");
    expect(runPipeline).not.toHaveBeenCalled();
    expect(await decisions()).toHaveLength(1);
    expect((await stored())?.status).toBe("drafted");
  });

  it("leaves the message processing, saves nothing and revokes the session when the run fails", async () => {
    runPipeline.mockRejectedValue(new Error("The model is unavailable"));

    await expect(process()).rejects.toThrow("The model is unavailable");

    expect((await stored())?.status).toBe("processing");
    expect(await decisions()).toHaveLength(0);

    const [session] = await database.db.select().from(mcpSessions);

    expect(session?.revokedAt).not.toBeNull();
  });

  it("revokes the session after a successful run", async () => {
    runPipeline.mockResolvedValue(answer);

    await process();

    const [session] = await database.db.select().from(mcpSessions);

    expect(session?.revokedAt).not.toBeNull();
  });

  describe("delivery (decision 0046)", () => {
    it("queues a draft delivery and publishes it when the playbook is in draft mode", async () => {
      await setMode(playbookId, "draft");
      runPipeline.mockResolvedValue(used(playbookId));

      await process();

      expect(await deliveryOf()).toEqual({ mode: "draft", state: "pending" });
      expect(publishDeliver).toHaveBeenCalledExactlyOnceWith({ messageId });
    });

    it("sends only when every playbook that the run used is in send mode", async () => {
      await setMode(playbookId, "send");
      runPipeline.mockResolvedValue(used(playbookId, await addPlaybook("send")));

      await process();

      expect(await deliveryOf()).toEqual({ mode: "send", state: "pending" });
    });

    it("makes the reply a draft when one playbook is in draft mode, has no conditions or is gone", async () => {
      await setMode(playbookId, "send");

      for (const other of [
        await addPlaybook("draft"),
        await addPlaybook(null),
        crypto.randomUUID(),
      ]) {
        await restart();
        runPipeline.mockResolvedValue(used(playbookId, other));

        await process();

        expect(await deliveryOf()).toEqual({ mode: "draft", state: "pending" });
      }
    });

    it("makes the reply a draft when a playbook that the run used is disabled", async () => {
      await setMode(playbookId, "send");
      await database.db
        .update(playbooks)
        .set({ enabled: false })
        .where(eq(playbooks.id, playbookId));
      runPipeline.mockResolvedValue(used(playbookId));

      await process();

      expect(await deliveryOf()).toEqual({ mode: "draft", state: "pending" });
    });

    it("makes the reply a draft when the message has no account", async () => {
      await setMode(playbookId, "send");
      await database.db
        .update(messages)
        .set({ channelAccountId: null })
        .where(eq(messages.id, messageId));
      runPipeline.mockResolvedValue(used(playbookId));

      await process();

      expect(await deliveryOf()).toEqual({ mode: "draft", state: "pending" });
    });

    it("queues no delivery for an escalation or a message that is not for the user", async () => {
      for (const outcome of ["escalate", "ignore"] as const) {
        await restart();
        runPipeline.mockResolvedValue({ ...answer, outcome, body: undefined, citations: [] });

        await process();

        expect(await deliveryOf()).toEqual({ mode: null, state: null });
      }

      expect(publishDeliver).not.toHaveBeenCalled();
    });

    it("publishes again when the job is delivered again for a reply that waits for delivery", async () => {
      runPipeline.mockResolvedValue(used(playbookId));

      await process();
      publishDeliver.mockClear();

      expect(await process()).toBe("processed");
      expect(publishDeliver).toHaveBeenCalledExactlyOnceWith({ messageId });
      expect(runPipeline).toHaveBeenCalledOnce();
    });

    it("publishes when the decision was saved but the message did not move", async () => {
      runPipeline.mockResolvedValue(used(playbookId));
      await process();
      await database.db
        .update(messages)
        .set({ status: "processing" })
        .where(eq(messages.id, messageId));
      publishDeliver.mockClear();

      await process();

      expect(publishDeliver).toHaveBeenCalledExactlyOnceWith({ messageId });
      expect((await stored())?.status).toBe("drafted");
    });

    it("does not publish again once the delivery has started", async () => {
      runPipeline.mockResolvedValue(used(playbookId));
      await process();
      await database.db
        .update(replyDecisions)
        .set({ deliveryState: "started", deliveryRequest: {}, deliveryStartedAt: NOW })
        .where(eq(replyDecisions.messageId, messageId));
      publishDeliver.mockClear();

      expect(await process()).toBe("ignored");
      expect(publishDeliver).not.toHaveBeenCalled();
    });
  });
});
