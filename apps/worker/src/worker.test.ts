import { deadLetterQueueName } from "@leren/queue";
import type { QueueClient, QueueMessage } from "@leren/queue";
import { createInMemoryQueue } from "@leren/queue/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { defineJob } from "./job";
import { Worker } from "./worker";

const FAST_BACKOFF = { initialDelayMs: 10, factor: 1, maxDelayMs: 10 };

async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;

  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error("Timed out waiting for the condition");
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("Worker", () => {
  let queue: QueueClient;
  let worker: Worker | undefined;

  beforeEach(() => {
    queue = createInMemoryQueue();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    await worker?.stop();
    await queue.close();
    vi.restoreAllMocks();
  });

  it("runs the handler with the validated payload and the delivery details", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);

    const job = defineJob({
      name: "greet",
      schema: z.object({ name: z.string() }),
      handler,
    });

    worker = new Worker({ queue, jobs: [job] });
    await worker.start();

    const published = await queue.publish("greet", { name: "Ada" }, { idempotencyKey: "greet-1" });

    await waitFor(() => handler.mock.calls.length === 1);

    expect(handler).toHaveBeenCalledWith(
      { name: "Ada" },
      expect.objectContaining({
        jobId: published.id,
        attempt: 1,
        idempotencyKey: "greet-1",
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("dead-letters an invalid payload without running the handler", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const deadLetters: QueueMessage[] = [];

    const job = defineJob({
      name: "greet",
      schema: z.object({ name: z.string() }),
      maxAttempts: 5,
      backoff: FAST_BACKOFF,
      handler,
    });

    worker = new Worker({ queue, jobs: [job] });
    await worker.start();
    await queue.consume(deadLetterQueueName("greet"), async (message) => {
      deadLetters.push(message);
    });
    await queue.publish("greet", { name: 42 });
    await waitFor(() => deadLetters.length === 1);

    expect(handler).not.toHaveBeenCalled();
    expect(deadLetters[0]?.lastError).toContain('Invalid payload for job "greet"');
  });

  it("retries a failing handler up to the job's maximum attempts and then dead-letters", async () => {
    const attempts: number[] = [];
    const deadLetters: QueueMessage[] = [];

    const job = defineJob({
      name: "flaky",
      schema: z.object({}),
      maxAttempts: 3,
      backoff: FAST_BACKOFF,
      async handler(_, context) {
        attempts.push(context.attempt);

        throw new Error("unavailable");
      },
    });

    worker = new Worker({ queue, jobs: [job] });
    await worker.start();
    await queue.consume(deadLetterQueueName("flaky"), async (message) => {
      deadLetters.push(message);
    });
    await queue.publish("flaky", {});
    await waitFor(() => deadLetters.length === 1);

    expect(attempts).toEqual([1, 2, 3]);
    expect(deadLetters[0]?.lastError).toBe("unavailable");
  });

  it("stops consuming every job queue", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const job = defineJob({ name: "quiet", schema: z.object({}), handler });

    worker = new Worker({ queue, jobs: [job] });
    await worker.start();
    await worker.stop();
    await queue.publish("quiet", {});
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(handler).not.toHaveBeenCalled();
  });
});
