import type { ChannelAccountsDependencies } from "@leren/channels";
import type { Db } from "@leren/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createEmailPollJob, EMAIL_POLL_QUEUE, requestEmailPolls } from "./job";
import { listPollableAccountIds, pollAccount } from "./service";

vi.mock("./service", () => ({ pollAccount: vi.fn(), listPollableAccountIds: vi.fn() }));

const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const db = {} as Db;
const POLL_INTERVAL_MS = 60_000;
const channels: ChannelAccountsDependencies = { providers: new Map(), encryptionKey: undefined };

function createContext() {
  return {
    jobId: "job-1",
    attempt: 1,
    idempotencyKey: "key-1",
    signal: new AbortController().signal,
  };
}

describe("email poll job", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(pollAccount).mockResolvedValue({ kind: "ingested", count: 1, unreadable: [] });
  });

  it("consumes the email.poll queue", () => {
    expect(
      createEmailPollJob({
        db,
        channels,
        queue: { publish: vi.fn() },
        pollIntervalMs: POLL_INTERVAL_MS,
      }).name,
    ).toBe(EMAIL_POLL_QUEUE);
  });

  it("polls the account named by the payload", async () => {
    await createEmailPollJob({
      db,
      channels,
      queue: { publish: vi.fn() },
      pollIntervalMs: POLL_INTERVAL_MS,
    }).handler({ accountId: ACCOUNT_ID, requestedAt: Date.now() }, createContext());

    expect(pollAccount).toHaveBeenCalledExactlyOnceWith(
      { db, channels, recordEmail: expect.any(Function) },
      ACCOUNT_ID,
    );
  });

  it("lets a failed poll fail the job so the queue retries it", async () => {
    vi.mocked(pollAccount).mockRejectedValue(new Error("Gmail is unavailable"));

    await expect(
      createEmailPollJob({
        db,
        channels,
        queue: { publish: vi.fn() },
        pollIntervalMs: POLL_INTERVAL_MS,
      }).handler({ accountId: ACCOUNT_ID, requestedAt: Date.now() }, createContext()),
    ).rejects.toThrow("Gmail is unavailable");
  });

  it("drops a poll that waited longer than two intervals", async () => {
    await createEmailPollJob({
      db,
      channels,
      queue: { publish: vi.fn() },
      pollIntervalMs: POLL_INTERVAL_MS,
    }).handler(
      { accountId: ACCOUNT_ID, requestedAt: Date.now() - 3 * POLL_INTERVAL_MS },
      createContext(),
    );

    expect(pollAccount).not.toHaveBeenCalled();
  });

  it("rejects a payload that does not name an account", () => {
    const { schema } = createEmailPollJob({
      db,
      channels,
      queue: { publish: vi.fn() },
      pollIntervalMs: POLL_INTERVAL_MS,
    });

    expect(schema.safeParse({ accountId: "not-an-id", requestedAt: 0 }).success).toBe(false);
  });
});

describe("requesting the email polls", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("publishes one poll for each account that can be polled", async () => {
    const publish = vi.fn().mockResolvedValue(undefined);

    vi.mocked(listPollableAccountIds).mockResolvedValue([ACCOUNT_ID, "b"]);

    expect(await requestEmailPolls({ db, channels, queue: { publish } })).toBe(2);
    expect(publish).toHaveBeenCalledWith(EMAIL_POLL_QUEUE, {
      accountId: ACCOUNT_ID,
      requestedAt: expect.any(Number),
    });
    expect(publish).toHaveBeenCalledWith(EMAIL_POLL_QUEUE, {
      accountId: "b",
      requestedAt: expect.any(Number),
    });
  });

  it("still requests the other accounts when one publish fails", async () => {
    const publish = vi
      .fn()
      .mockRejectedValueOnce(new Error("queue is down"))
      .mockResolvedValue(undefined);

    vi.mocked(listPollableAccountIds).mockResolvedValue(["a", "b"]);

    await expect(requestEmailPolls({ db, channels, queue: { publish } })).resolves.toBe(2);
    expect(publish).toHaveBeenCalledTimes(2);
  });
});
