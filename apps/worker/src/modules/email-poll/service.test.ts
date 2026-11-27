import { randomBytes } from "node:crypto";

import { encryptCredentials, InvalidGrantError } from "@leren/channels";
import type { ChannelProvider, EmailProvider, FetchResult } from "@leren/channels";
import { channelAccounts, users } from "@leren/db";
import { createTestDatabase } from "@leren/db/testing";
import type { TestDatabase } from "@leren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { listPollableAccountIds, pollAccount } from "./service";

const MISSING_ID = "00000000-0000-4000-8000-000000000000";

const EMAIL = {
  providerMessageId: "m1",
  providerThreadId: "t1",
  from: "ana@example.com",
  to: ["me@example.com"],
  subject: "Hello",
  body: "Body",
  receivedAt: new Date("2026-11-22T12:00:00Z"),
};

function createProvider(): ChannelProvider {
  return {
    name: "google",
    channel: "email",
    displayName: "Google",
    start: vi.fn(),
    finish: vi.fn(),
    refresh: vi.fn(),
    revoke: vi.fn(),
  };
}

function createReader(fetchNewMail: EmailProvider["fetchNewMail"]): EmailProvider {
  return { ...createProvider(), fetchNewMail };
}

describe("the email poll", () => {
  let database: TestDatabase;
  let userId: string;
  let accountId: string;
  let credentials: string;
  const key = randomBytes(32);
  const recordEmail = vi.fn();
  const fetchNewMail = vi.fn<EmailProvider["fetchNewMail"]>();

  const dependencies = (providers: ReadonlyMap<string, ChannelProvider>) => ({
    db: database.db,
    channels: { providers, encryptionKey: key },
    recordEmail,
  });

  const enabled = () =>
    dependencies(new Map<string, ChannelProvider>([["google", createReader(fetchNewMail)]]));

  const cursorOf = async () => {
    const [row] = await database.db
      .select({ cursor: channelAccounts.syncCursor })
      .from(channelAccounts)
      .where(eq(channelAccounts.id, accountId));

    return row?.cursor;
  };

  const setAccount = (values: Partial<typeof channelAccounts.$inferInsert>) =>
    database.db.update(channelAccounts).set(values).where(eq(channelAccounts.id, accountId));

  beforeAll(async () => {
    database = await createTestDatabase();

    const [user] = await database.db
      .insert(users)
      .values({ email: "me@example.com" })
      .returning({ id: users.id });

    userId = user?.id ?? "";

    accountId = crypto.randomUUID();

    credentials = encryptCredentials(
      key,
      accountId,
      JSON.stringify({ accessToken: "access-token", refreshToken: "refresh", expiresAt: null }),
    );

    await database.db.insert(channelAccounts).values({
      id: accountId,
      userId,
      channel: "email",
      provider: "google",
      providerAccountId: "sub-1",
      label: "me@example.com",
      credentials,
    });
  });

  beforeEach(async () => {
    vi.resetAllMocks();
    recordEmail.mockResolvedValue({ messageId: "id", created: true });
    fetchNewMail.mockResolvedValue({ emails: [], cursor: "10", baseline: false, unreadable: [] });

    await setAccount({ status: "active", syncCursor: null, credentials });
  });

  afterAll(async () => {
    await database.drop();
  });

  it("stores the current position and records nothing on the first poll", async () => {
    fetchNewMail.mockResolvedValue({ emails: [], cursor: "100", baseline: true, unreadable: [] });

    expect(await pollAccount(enabled(), accountId)).toEqual({ kind: "baseline", gap: false });
    expect(fetchNewMail).toHaveBeenCalledWith("access-token", null);
    expect(recordEmail).not.toHaveBeenCalled();
    expect(await cursorOf()).toBe("100");
  });

  it("records each email for the account's owner and then stores the cursor", async () => {
    await setAccount({ syncCursor: "100" });

    fetchNewMail.mockResolvedValue({
      emails: [EMAIL, { ...EMAIL, providerMessageId: "m2" }],
      cursor: "120",
      baseline: false,
      unreadable: [],
    } satisfies FetchResult);

    expect(await pollAccount(enabled(), accountId)).toEqual({
      kind: "ingested",
      count: 2,
      unreadable: [],
    });
    expect(fetchNewMail).toHaveBeenCalledWith("access-token", "100");
    expect(recordEmail).toHaveBeenCalledTimes(2);
    expect(recordEmail).toHaveBeenCalledWith({
      ...EMAIL,
      userId,
      channelAccountId: accountId,
      channel: "email",
      provider: "google",
    });
    expect(await cursorOf()).toBe("120");
  });

  it("reports a gap when the provider can no longer resume from the stored cursor", async () => {
    await setAccount({ syncCursor: "1" });
    fetchNewMail.mockResolvedValue({ emails: [], cursor: "900", baseline: true, unreadable: [] });

    expect(await pollAccount(enabled(), accountId)).toEqual({ kind: "baseline", gap: true });
    expect(await cursorOf()).toBe("900");
  });

  it("reports the messages that were left out because they could not be read", async () => {
    await setAccount({ syncCursor: "100" });
    fetchNewMail.mockResolvedValue({
      emails: [EMAIL],
      cursor: "120",
      baseline: false,
      unreadable: ["bad"],
    });

    expect(await pollAccount(enabled(), accountId)).toEqual({
      kind: "ingested",
      count: 1,
      unreadable: ["bad"],
    });
    expect(await cursorOf()).toBe("120");
  });

  it("keeps the cursor when the mailbox cannot be read", async () => {
    await setAccount({ syncCursor: "100" });
    fetchNewMail.mockRejectedValue(new Error("Gmail is unavailable"));

    await expect(pollAccount(enabled(), accountId)).rejects.toThrow("Gmail is unavailable");
    expect(recordEmail).not.toHaveBeenCalled();
    expect(await cursorOf()).toBe("100");
  });

  it("makes the account revoked and keeps the cursor when the mailbox refuses the credentials", async () => {
    await setAccount({ syncCursor: "100" });
    fetchNewMail.mockRejectedValue(new InvalidGrantError("The IMAP server refused the password"));

    expect(await pollAccount(enabled(), accountId)).toEqual({ kind: "revoked" });

    const [row] = await database.db
      .select({ status: channelAccounts.status })
      .from(channelAccounts)
      .where(eq(channelAccounts.id, accountId));

    expect(row?.status).toBe("revoked");
    expect(recordEmail).not.toHaveBeenCalled();
    expect(await cursorOf()).toBe("100");
  });

  it("keeps the cursor when an email cannot be recorded", async () => {
    await setAccount({ syncCursor: "100" });
    fetchNewMail.mockResolvedValue({
      emails: [EMAIL],
      cursor: "120",
      baseline: false,
      unreadable: [],
    });
    recordEmail.mockRejectedValue(new Error("queue is down"));

    await expect(pollAccount(enabled(), accountId)).rejects.toThrow("queue is down");
    expect(await cursorOf()).toBe("100");
  });

  it("does not move the cursor that another poll or a reconnection changed", async () => {
    await setAccount({ syncCursor: "100" });

    fetchNewMail.mockImplementation(async () => {
      await setAccount({ syncCursor: null });

      return { emails: [], cursor: "120", baseline: false, unreadable: [] };
    });

    await pollAccount(enabled(), accountId);

    expect(await cursorOf()).toBeNull();
  });

  describe("skips an account that cannot be polled", () => {
    it.each([
      ["that does not exist", MISSING_ID],
      ["that is revoked", undefined],
    ])("%s", async (_label, id) => {
      await setAccount({ status: "revoked" });

      expect(await pollAccount(enabled(), id ?? accountId)).toEqual({ kind: "skipped" });
      expect(fetchNewMail).not.toHaveBeenCalled();
    });

    it("whose provider is not enabled", async () => {
      expect(await pollAccount(dependencies(new Map()), accountId)).toEqual({ kind: "skipped" });
    });

    it("whose provider cannot read a mailbox", async () => {
      const providers = new Map<string, ChannelProvider>([["google", createProvider()]]);

      expect(await pollAccount(dependencies(providers), accountId)).toEqual({ kind: "skipped" });
    });

    it("that has no credentials", async () => {
      await setAccount({ credentials: null });

      expect(await pollAccount(enabled(), accountId)).toEqual({ kind: "skipped" });
    });
  });

  describe("lists the accounts to poll", () => {
    it("includes an active account whose provider can read a mailbox", async () => {
      expect(await listPollableAccountIds(database.db, enabled().channels.providers)).toEqual([
        accountId,
      ]);
    });

    it("leaves out revoked accounts, disabled providers and providers that cannot read", async () => {
      expect(await listPollableAccountIds(database.db, new Map())).toEqual([]);

      const noReader = new Map<string, ChannelProvider>([["google", createProvider()]]);

      expect(await listPollableAccountIds(database.db, noReader)).toEqual([]);

      await setAccount({ status: "revoked" });

      expect(await listPollableAccountIds(database.db, enabled().channels.providers)).toEqual([]);
    });
  });
});
