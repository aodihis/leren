import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { NonRetryableError } from "./errors";
import { deadLetterQueueName } from "./names";
import type { BackoffPolicy, QueueClient, QueueMessage } from "./types";

const FAST_BACKOFF: BackoffPolicy = { initialDelayMs: 20, factor: 2, maxDelayMs: 100 };

async function waitFor(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error("Timed out waiting for the condition");
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/**
 * Runs the behaviour every `QueueClient` must have. The RabbitMQ client and the in-memory fake
 * run the same cases, so the fake stays faithful to the real broker. Each case uses a queue name
 * of its own, so cases do not see each other's messages on a broker that keeps its queues.
 */
export function describeQueueContract(name: string, create: () => Promise<QueueClient>): void {
  describe(`${name} queue contract`, () => {
    let client: QueueClient;

    beforeAll(async () => {
      client = await create();
    });

    afterAll(async () => {
      await client.close();
    });

    it("delivers a published payload on the first attempt", async () => {
      const queue = `contract.${randomUUID()}`;
      const received: QueueMessage[] = [];

      await client.consume(queue, async (message) => void received.push(message));

      const published = await client.publish(queue, { greeting: "hello" });

      await waitFor(() => received.length === 1);

      expect(received[0]).toMatchObject({
        id: published.id,
        queue,
        payload: { greeting: "hello" },
        attempt: 1,
        idempotencyKey: published.id,
      });
      expect(received[0]?.lastError).toBeUndefined();
    });

    it("carries the idempotency key given at publish", async () => {
      const queue = `contract.${randomUUID()}`;
      const received: QueueMessage[] = [];

      await client.consume(queue, async (message) => void received.push(message));
      await client.publish(queue, {}, { idempotencyKey: "email-42" });
      await waitFor(() => received.length === 1);

      expect(received[0]?.idempotencyKey).toBe("email-42");
    });

    it("keeps messages published before any consumer exists", async () => {
      const queue = `contract.${randomUUID()}`;
      const received: unknown[] = [];

      await client.publish(queue, { n: 1 });
      await client.publish(queue, { n: 2 });
      await client.consume(queue, async (message) => void received.push(message.payload));
      await waitFor(() => received.length === 2);

      expect(received).toEqual([{ n: 1 }, { n: 2 }]);
    });

    it("retries a failing handler with an increasing attempt until it succeeds", async () => {
      const queue = `contract.${randomUUID()}`;
      const attempts: QueueMessage[] = [];

      await client.consume(
        queue,
        async (message) => {
          attempts.push(message);

          if (message.attempt < 3) {
            throw new Error(`failure ${message.attempt}`);
          }
        },
        { maxAttempts: 5, backoff: FAST_BACKOFF },
      );
      await client.publish(queue, { work: true });
      await waitFor(() => attempts.length === 3);

      expect(attempts.map((message) => message.attempt)).toEqual([1, 2, 3]);
      expect(attempts.map((message) => message.lastError)).toEqual([
        undefined,
        "failure 1",
        "failure 2",
      ]);
      expect(new Set(attempts.map((message) => message.id)).size).toBe(1);
    });

    it("moves a message to the dead-letter queue when the attempts are used up", async () => {
      const queue = `contract.${randomUUID()}`;
      const attempts: number[] = [];
      const deadLetters: QueueMessage[] = [];

      await client.consume(
        queue,
        async (message) => {
          attempts.push(message.attempt);

          throw new Error("always fails");
        },
        { maxAttempts: 2, backoff: FAST_BACKOFF },
      );
      await client.consume(
        deadLetterQueueName(queue),
        async (message) => void deadLetters.push(message),
      );
      await client.publish(queue, { work: true }, { idempotencyKey: "work-1" });
      await waitFor(() => deadLetters.length === 1);
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(attempts).toEqual([1, 2]);
      expect(deadLetters).toHaveLength(1);
      expect(deadLetters[0]).toMatchObject({
        payload: { work: true },
        idempotencyKey: "work-1",
        lastError: "always fails",
      });
    });

    it("dead-letters a non-retryable failure without another attempt", async () => {
      const queue = `contract.${randomUUID()}`;
      const attempts: number[] = [];
      const deadLetters: QueueMessage[] = [];

      await client.consume(
        queue,
        async (message) => {
          attempts.push(message.attempt);

          throw new NonRetryableError("invalid payload");
        },
        { maxAttempts: 5, backoff: FAST_BACKOFF },
      );
      await client.consume(
        deadLetterQueueName(queue),
        async (message) => void deadLetters.push(message),
      );
      await client.publish(queue, {});
      await waitFor(() => deadLetters.length === 1);
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(attempts).toEqual([1]);
      expect(deadLetters[0]?.lastError).toBe("invalid payload");
    });

    it("handles no more messages at once than the concurrency allows", async () => {
      const queue = `contract.${randomUUID()}`;
      let running = 0;
      let peak = 0;
      let finished = 0;

      await client.consume(
        queue,
        async () => {
          running += 1;
          peak = Math.max(peak, running);
          await new Promise((resolve) => setTimeout(resolve, 40));
          running -= 1;
          finished += 1;
        },
        { concurrency: 2 },
      );

      for (let index = 0; index < 6; index += 1) {
        await client.publish(queue, { index });
      }

      await waitFor(() => finished === 6);

      expect(peak).toBe(2);
    });

    it("stops delivering after the consumer is stopped", async () => {
      const queue = `contract.${randomUUID()}`;
      const received: unknown[] = [];

      const consumer = await client.consume(queue, async (message) => {
        received.push(message.payload);
      });

      await consumer.stop();
      await client.publish(queue, { late: true });
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(received).toEqual([]);

      const resumed: unknown[] = [];

      await client.consume(queue, async (message) => void resumed.push(message.payload));
      await waitFor(() => resumed.length === 1);

      expect(resumed).toEqual([{ late: true }]);
    });

    it("aborts a running handler on stop and delivers its message again at the same attempt", async () => {
      const queue = `contract.${randomUUID()}`;
      const started: number[] = [];

      const first = await client.consume(
        queue,
        (message, { signal }) =>
          new Promise<void>((_, reject) => {
            started.push(message.attempt);
            signal.addEventListener("abort", () => reject(new Error("aborted")));
          }),
        { maxAttempts: 1 },
      );

      await client.publish(queue, { work: true });
      await waitFor(() => started.length === 1);
      await first.stop();

      const second: QueueMessage[] = [];

      await client.consume(queue, async (message) => void second.push(message));
      await waitFor(() => second.length === 1);

      expect(second[0]).toMatchObject({ attempt: 1, payload: { work: true } });
    });
  });
}
