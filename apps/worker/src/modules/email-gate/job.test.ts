import { EMAIL_PROCESS_QUEUE, EMAIL_RECEIVED_QUEUE } from "@leren/inbox";
import type { Db } from "@leren/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createEmailGateJob } from "./job";
import { gateMessage } from "./service";

vi.mock("./service", () => ({ gateMessage: vi.fn() }));

const MESSAGE_ID = "11111111-1111-4111-8111-111111111111";
const db = {} as Db;

function createContext() {
  return {
    jobId: "job-1",
    attempt: 1,
    idempotencyKey: "key-1",
    signal: new AbortController().signal,
  };
}

describe("email gate job", () => {
  beforeEach(() => {
    vi.mocked(gateMessage).mockResolvedValue("queued");
  });

  it("consumes the email.received queue", () => {
    expect(createEmailGateJob({ db, queue: { publish: vi.fn() } }).name).toBe(EMAIL_RECEIVED_QUEUE);
  });

  it("gates the message named by the payload", async () => {
    await createEmailGateJob({ db, queue: { publish: vi.fn() } }).handler(
      { messageId: MESSAGE_ID },
      createContext(),
    );

    expect(gateMessage).toHaveBeenCalledExactlyOnceWith(
      { db, publishProcess: expect.any(Function) },
      MESSAGE_ID,
    );
  });

  it("publishes to email.process with the record id as the idempotency key", async () => {
    const publish = vi.fn();
    const message = { messageId: MESSAGE_ID, playbooks: [] };

    vi.mocked(gateMessage).mockImplementation(async ({ publishProcess }) => {
      await publishProcess(message as never);

      return "queued";
    });

    await createEmailGateJob({ db, queue: { publish } }).handler(
      { messageId: MESSAGE_ID },
      createContext(),
    );

    expect(publish).toHaveBeenCalledExactlyOnceWith(EMAIL_PROCESS_QUEUE, message, {
      idempotencyKey: MESSAGE_ID,
    });
  });

  it("lets a failure reach the worker so the message is retried", async () => {
    vi.mocked(gateMessage).mockRejectedValue(new Error("Database is down"));

    await expect(
      createEmailGateJob({ db, queue: { publish: vi.fn() } }).handler(
        { messageId: MESSAGE_ID },
        createContext(),
      ),
    ).rejects.toThrow("Database is down");
  });
});
