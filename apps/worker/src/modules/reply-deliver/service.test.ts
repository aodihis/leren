import {
  DeliveryNotSentError,
  DeliveryRejectedError,
  getAccessToken,
  InvalidGrantError,
} from "@leren/channels";
import type * as Channels from "@leren/channels";
import type { ChannelAccountsDependencies, EmailSender, OutboundReply } from "@leren/channels";
import { channelAccounts, messages, replyDecisions, users } from "@leren/db";
import { createTestDatabase } from "@leren/db/testing";
import type { TestDatabase } from "@leren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DELIVERY_REFUSED,
  DELIVERY_UNAVAILABLE,
  DELIVERY_UNKNOWN,
  deliverReply,
  failDelivery,
  failUnfinishedDelivery,
} from "./service";

vi.mock("@leren/channels", async (importOriginal) => ({
  ...(await importOriginal<typeof Channels>()),
  getAccessToken: vi.fn(),
}));

const OWN_ADDRESS = "owner@example.com";

type Receipt = Awaited<ReturnType<EmailSender["sendReply"]>>;

function createSender() {
  return {
    name: "google" as const,
    channel: "email" as const,
    displayName: "Google",
    start: vi.fn(),
    finish: vi.fn(),
    refresh: vi.fn(),
    revoke: vi.fn(),
    readReplyContext: vi.fn<EmailSender["readReplyContext"]>().mockResolvedValue({
      messageId: "<original@example.com>",
      references: "<first@example.com>",
      replyTo: null,
    }),
    createDraft: vi
      .fn<(token: string, reply: OutboundReply) => Promise<Receipt>>()
      .mockResolvedValue({ id: "draft-1", response: { id: "draft-1" } }),
    sendReply: vi
      .fn<(token: string, reply: OutboundReply) => Promise<Receipt>>()
      .mockResolvedValue({ id: "sent-1", response: { id: "sent-1", labelIds: ["SENT"] } }),
  };
}

describe("deliverReply", () => {
  let database: TestDatabase;
  let userId: string;
  let accountId: string;
  let messageId: string;
  const sender = createSender();

  const channels = (): ChannelAccountsDependencies => ({
    providers: new Map<string, EmailSender>([["google", sender]]),
    encryptionKey: undefined,
  });

  const run = () => deliverReply({ db: database.db, channels: channels() }, { messageId });

  const decision = async () => {
    const [row] = await database.db
      .select()
      .from(replyDecisions)
      .where(eq(replyDecisions.messageId, messageId));

    return row;
  };

  const status = async () => {
    const [row] = await database.db.select().from(messages).where(eq(messages.id, messageId));

    return { status: row?.status, reason: row?.statusReason };
  };

  const insertReply = async (
    options: {
      mode?: "draft" | "send";
      state?: "pending" | "started" | "completed" | "failed";
      isBulk?: boolean;
      from?: string;
      messageStatus?: "drafted" | "sent";
    } = {},
  ) => {
    await database.db.delete(messages);

    const [message] = await database.db
      .insert(messages)
      .values({
        userId,
        channelAccountId: accountId,
        channel: "email",
        provider: "google",
        providerMessageId: crypto.randomUUID(),
        providerThreadId: "thread-1",
        fromAddress: options.from ?? "sender@example.com",
        subject: "Deadline",
        body: "When is the deadline?",
        isBulk: options.isBulk ?? false,
        receivedAt: new Date(),
        status: options.messageStatus ?? "drafted",
      })
      .returning({ id: messages.id });

    messageId = message?.id ?? "";

    const state = options.state ?? "pending";

    const values: typeof replyDecisions.$inferInsert = {
      messageId,
      userId,
      outcome: "answer",
      body: "The deadline is Friday.",
      deliveryMode: options.mode ?? "draft",
      deliveryState: state,
    };

    if (state === "started") {
      values.deliveryRequest = {};
      values.deliveryStartedAt = new Date();
      values.deliveryAttempts = 1;
    }

    await database.db.insert(replyDecisions).values(values);
  };

  beforeAll(async () => {
    database = await createTestDatabase();

    const [user] = await database.db
      .insert(users)
      .values({ email: OWN_ADDRESS })
      .returning({ id: users.id });

    userId = user?.id ?? "";

    const [account] = await database.db
      .insert(channelAccounts)
      .values({
        userId,
        channel: "email",
        provider: "google",
        providerAccountId: "sub-1",
        label: OWN_ADDRESS,
        credentials: "unused",
      })
      .returning({ id: channelAccounts.id });

    accountId = account?.id ?? "";
  });

  const accountStatus = async () => {
    const [row] = await database.db
      .select({ status: channelAccounts.status })
      .from(channelAccounts)
      .where(eq(channelAccounts.id, accountId));

    return row?.status;
  };

  beforeEach(async () => {
    await database.db
      .update(channelAccounts)
      .set({ status: "active" })
      .where(eq(channelAccounts.id, accountId));
    vi.mocked(getAccessToken).mockResolvedValue("token");
    sender.readReplyContext.mockClear();
    sender.createDraft.mockClear();
    sender.sendReply.mockClear();
  });

  afterAll(async () => {
    await database.drop();
  });

  describe("with a usable account", () => {
    it("creates a draft, stores its id and the whole answer, and leaves the message drafted", async () => {
      await insertReply({ mode: "draft" });

      expect(await run()).toBe("delivered");

      expect(await decision()).toMatchObject({
        deliveryState: "completed",
        deliveryAttempts: 1,
        mailboxDraftId: "draft-1",
        sentMessageId: null,
        deliveryResponse: { id: "draft-1" },
      });
      expect(await status()).toMatchObject({ status: "drafted" });
      expect(sender.sendReply).not.toHaveBeenCalled();
    });

    it("sends the reply, stores the id of the sent message and moves the message to sent", async () => {
      await insertReply({ mode: "send" });

      expect(await run()).toBe("delivered");

      expect(await decision()).toMatchObject({
        deliveryState: "completed",
        sentMessageId: "sent-1",
        mailboxDraftId: null,
      });
      expect(await status()).toMatchObject({ status: "sent" });
      expect(sender.createDraft).not.toHaveBeenCalled();
    });

    it("stores the exact request before the call and builds it from the original", async () => {
      await insertReply({ mode: "draft" });

      expect(await run()).toBe("delivered");

      const [original] = await database.db
        .select({ providerMessageId: messages.providerMessageId })
        .from(messages)
        .where(eq(messages.id, messageId));

      const reply = {
        to: "sender@example.com",
        subject: "Re: Deadline",
        body: "The deadline is Friday.",
        providerMessageId: original?.providerMessageId,
        threadId: "thread-1",
        messageId: `<leren-${messageId}@leren.local>`,
        inReplyTo: "<original@example.com>",
        references: "<first@example.com> <original@example.com>",
      };

      expect((await decision())?.deliveryRequest).toEqual({ mode: "draft", ...reply });
      expect(sender.createDraft).toHaveBeenCalledWith("token", reply);
    });

    it("writes the started record before the provider is called", async () => {
      await insertReply({ mode: "draft" });

      const during: Awaited<ReturnType<typeof decision>>[] = [];

      sender.createDraft.mockImplementationOnce(async () => {
        during.push(await decision());

        return { id: "draft-1", response: {} };
      });

      await run();

      expect(during).toHaveLength(1);
      expect(during[0]).toMatchObject({
        deliveryState: "started",
        deliveryAttempts: 1,
        deliveryRequest: { to: "sender@example.com" },
      });
    });

    it("replies to the Reply-To address of the original when it has one", async () => {
      await insertReply();
      sender.readReplyContext.mockResolvedValueOnce({
        messageId: null,
        references: null,
        replyTo: "support@example.com",
      });

      await run();

      expect(sender.createDraft).toHaveBeenCalledWith(
        "token",
        expect.objectContaining({ to: "support@example.com", inReplyTo: null, references: null }),
      );
    });

    it("does not add a second Re: to a subject that has one", async () => {
      await insertReply();
      await database.db
        .update(messages)
        .set({ subject: "RE: Deadline" })
        .where(eq(messages.id, messageId));

      await run();

      expect(sender.createDraft).toHaveBeenCalledWith(
        "token",
        expect.objectContaining({ subject: "RE: Deadline" }),
      );
    });

    it("does nothing for a delivery that is already complete, and does not call the provider", async () => {
      await insertReply();
      await run();
      sender.createDraft.mockClear();

      expect(await run()).toBe("ignored");
      expect(sender.createDraft).not.toHaveBeenCalled();
    });

    it("redacts the text of the message once a draft exists, and again on a repeat delivery", async () => {
      const personal = "Write to jane.doe@example.org";

      await insertReply();
      await database.db.update(messages).set({ body: personal }).where(eq(messages.id, messageId));
      await run();

      const stored = async () =>
        (await database.db.select().from(messages).where(eq(messages.id, messageId)))[0]?.body;

      expect(await stored()).toBe("Write to [redacted]");

      await database.db.update(messages).set({ body: personal }).where(eq(messages.id, messageId));
      await run();

      expect(await stored()).toBe("Write to [redacted]");
    });

    it("never calls the provider again for a delivery that started and has no end", async () => {
      await insertReply({ state: "started" });

      expect(await run()).toBe("unknown");

      expect(await decision()).toMatchObject({
        deliveryState: "failed",
        deliveryError: DELIVERY_UNKNOWN,
        deliveryAttempts: 1,
      });
      expect((await decision())?.deliveryRequest).toEqual({});
      expect(await status()).toEqual({ status: "failed", reason: DELIVERY_UNKNOWN });
      expect(sender.createDraft).not.toHaveBeenCalled();
      expect(sender.sendReply).not.toHaveBeenCalled();
    });

    it("leaves a delivery started when the outcome of the call is not known, and a second run never repeats it", async () => {
      await insertReply({ mode: "send" });
      sender.sendReply.mockRejectedValueOnce(new Error("socket hang up"));

      await expect(run()).rejects.toThrow("socket hang up");
      expect(await decision()).toMatchObject({ deliveryState: "started", deliveryAttempts: 1 });

      expect(await run()).toBe("unknown");
      expect(sender.sendReply).toHaveBeenCalledOnce();
      expect(await status()).toMatchObject({ status: "failed", reason: DELIVERY_UNKNOWN });
    });

    it("puts the delivery back to pending when the call is known not to have reached the provider, then delivers on the retry", async () => {
      await insertReply({ mode: "draft" });
      sender.createDraft.mockRejectedValueOnce(new DeliveryNotSentError("Gmail was not reached"));

      await expect(run()).rejects.toBeInstanceOf(DeliveryNotSentError);
      expect(await decision()).toMatchObject({ deliveryState: "pending", deliveryAttempts: 1 });

      expect(await run()).toBe("delivered");
      expect(await decision()).toMatchObject({ deliveryState: "completed", deliveryAttempts: 2 });
    });

    it("makes the account revoked and fails the delivery when the mailbox refuses the credentials during the call", async () => {
      await insertReply({ mode: "send" });
      sender.sendReply.mockRejectedValueOnce(
        new InvalidGrantError("The server refused the password"),
      );

      expect(await run()).toBe("refused");

      expect(await decision()).toMatchObject({
        deliveryState: "failed",
        deliveryError: DELIVERY_UNAVAILABLE,
      });
      expect(await status()).toEqual({ status: "failed", reason: DELIVERY_UNAVAILABLE });
      expect(await accountStatus()).toBe("revoked");
    });

    it("makes the account revoked without a call when the mailbox refuses the credentials while the original is read", async () => {
      await insertReply({ mode: "draft" });
      sender.readReplyContext.mockRejectedValueOnce(
        new InvalidGrantError("The server refused the password"),
      );

      expect(await run()).toBe("refused");

      expect(await status()).toEqual({ status: "failed", reason: DELIVERY_UNAVAILABLE });
      expect(await accountStatus()).toBe("revoked");
      expect(sender.createDraft).not.toHaveBeenCalled();
    });

    it("fails the delivery and the message when the provider refuses the reply", async () => {
      await insertReply({ mode: "send" });
      sender.sendReply.mockRejectedValueOnce(new DeliveryRejectedError("forbidden", "no scope"));

      expect(await run()).toBe("rejected");

      expect(await decision()).toMatchObject({
        deliveryState: "failed",
        deliveryError: "forbidden: no scope",
      });
      expect(await status()).toEqual({ status: "failed", reason: "forbidden" });
    });

    it("finishes the move to sent when a retry finds a sent mail whose message did not move", async () => {
      await insertReply({ mode: "send" });
      await run();
      await database.db
        .update(messages)
        .set({ status: "drafted" })
        .where(eq(messages.id, messageId));
      sender.sendReply.mockClear();

      expect(await run()).toBe("delivered");
      expect(await status()).toMatchObject({ status: "sent" });
      expect(sender.sendReply).not.toHaveBeenCalled();
    });

    it("leaves a message that was sent alone when the last attempt of the job fails", async () => {
      await insertReply({ mode: "send" });
      await run();

      expect(await failDelivery(database.db, messageId, "delivery_error")).toBe(false);
      expect(await status()).toMatchObject({ status: "sent" });
    });

    it("replies to the sender when the Reply-To address is in another domain", async () => {
      await insertReply();
      sender.readReplyContext.mockResolvedValueOnce({
        messageId: null,
        references: null,
        replyTo: "victim@other.example",
      });

      await run();

      expect(sender.createDraft).toHaveBeenCalledWith(
        "token",
        expect.objectContaining({ to: "sender@example.com" }),
      );
    });

    it("finishes the move to failed when a retry finds a failed delivery on a drafted message", async () => {
      await insertReply();
      await database.db
        .update(replyDecisions)
        .set({ deliveryState: "failed", deliveryError: DELIVERY_REFUSED })
        .where(eq(replyDecisions.messageId, messageId));

      expect(await run()).toBe("ignored");
      expect(await status()).toEqual({ status: "failed", reason: DELIVERY_REFUSED });
    });

    it("refuses to reply to an address of the account that the Reply-To header names", async () => {
      await insertReply();
      sender.readReplyContext.mockResolvedValueOnce({
        messageId: null,
        references: null,
        replyTo: OWN_ADDRESS,
      });

      expect(await run()).toBe("refused");
      expect(await status()).toEqual({ status: "failed", reason: DELIVERY_REFUSED });
      expect(sender.createDraft).not.toHaveBeenCalled();
    });

    it("does not repeat the id of the original in the references", async () => {
      await insertReply();
      sender.readReplyContext.mockResolvedValueOnce({
        messageId: "<original@example.com>",
        references: "<first@example.com> <original@example.com>",
        replyTo: null,
      });

      await run();

      expect(sender.createDraft).toHaveBeenCalledWith(
        "token",
        expect.objectContaining({ references: "<first@example.com> <original@example.com>" }),
      );
    });

    it("keeps the receipt and the state when a second run declared the delivery unknown during the call", async () => {
      await insertReply({ mode: "send" });
      sender.sendReply.mockImplementationOnce(async () => {
        await run();

        return { id: "sent-1", response: { id: "sent-1" } };
      });

      await run();

      expect(await decision()).toMatchObject({
        deliveryState: "failed",
        deliveryError: DELIVERY_UNKNOWN,
        sentMessageId: "sent-1",
        deliveryResponse: { id: "sent-1" },
      });
      expect(await status()).toMatchObject({ status: "failed" });
    });

    it("ends a delivery that is still started on the last attempt as unknown", async () => {
      await insertReply({ state: "started" });

      expect(await failUnfinishedDelivery(database.db, messageId, "socket hang up")).toBe(true);
      expect(await decision()).toMatchObject({ deliveryError: "delivery_unknown: socket hang up" });
      expect(await status()).toEqual({ status: "failed", reason: DELIVERY_UNKNOWN });
    });

    it("ends a delivery that is pending on the last attempt as an error", async () => {
      await insertReply();

      await failUnfinishedDelivery(database.db, messageId, "queue down");

      expect(await status()).toEqual({ status: "failed", reason: "delivery_error" });
    });

    it("keeps the code of the cause as the reason when a retry finishes the move to failed", async () => {
      await insertReply();
      await database.db
        .update(replyDecisions)
        .set({ deliveryState: "failed", deliveryError: "forbidden: no scope" })
        .where(eq(replyDecisions.messageId, messageId));

      await run();

      expect(await status()).toEqual({ status: "failed", reason: "forbidden" });
    });

    it("refuses to reply to bulk mail, without a call", async () => {
      await insertReply({ isBulk: true });

      expect(await run()).toBe("refused");

      expect(await decision()).toMatchObject({
        deliveryState: "failed",
        deliveryError: DELIVERY_REFUSED,
      });
      expect(await status()).toEqual({ status: "failed", reason: DELIVERY_REFUSED });
      expect(sender.createDraft).not.toHaveBeenCalled();
      expect(sender.readReplyContext).not.toHaveBeenCalled();
    });

    it("refuses to reply to a mail that comes from the account itself", async () => {
      await insertReply({ from: "Owner@Example.com" });

      expect(await run()).toBe("refused");
      expect(await status()).toEqual({ status: "failed", reason: DELIVERY_REFUSED });
      expect(sender.createDraft).not.toHaveBeenCalled();
    });

    it("does nothing when the message is not drafted", async () => {
      await insertReply({ messageStatus: "sent" });

      expect(await run()).toBe("ignored");
      expect(sender.createDraft).not.toHaveBeenCalled();
    });

    it("does nothing for a message that has no decision", async () => {
      await database.db.delete(messages);

      expect(await run()).toBe("ignored");
    });
  });

  it("fails the delivery when the account has no usable credentials", async () => {
    vi.mocked(getAccessToken).mockResolvedValue(null);
    await insertReply();

    expect(await run()).toBe("refused");
    expect(await status()).toEqual({ status: "failed", reason: DELIVERY_UNAVAILABLE });
    expect(sender.createDraft).not.toHaveBeenCalled();
  });

  it("fails the delivery when the provider cannot deliver", async () => {
    await insertReply();

    expect(
      await deliverReply(
        { db: database.db, channels: { providers: new Map(), encryptionKey: undefined } },
        { messageId },
      ),
    ).toBe("refused");
    expect(await status()).toEqual({ status: "failed", reason: DELIVERY_UNAVAILABLE });
  });
});
