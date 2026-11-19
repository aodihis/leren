import { randomUUID } from "node:crypto";

import { connect } from "amqplib";
import type { ConfirmChannel, ConsumeMessage, Options } from "amqplib";

import { getBackoffDelayMs, resolveConsumeOptions } from "./backoff";
import { describeError } from "./errors";
import { deadLetterQueueName, retryQueueName } from "./names";
import { planFailure } from "./retry";
import type {
  Consumer,
  ConsumeOptions,
  MessageHandler,
  PublishOptions,
  QueueClient,
  QueueMessage,
} from "./types";

const ATTEMPT_HEADER = "x-attempt";
const IDEMPOTENCY_KEY_HEADER = "x-idempotency-key";
const LAST_ERROR_HEADER = "x-last-error";

export type RabbitMqQueueOptions = {
  url: string;
  /** Called when a delivery cannot be settled. The delivery is requeued. Defaults to logging. */
  onError?: (error: Error) => void;
  /**
   * Called when the connection is lost without `close` being called. The client does not
   * reconnect, so the process should exit and let its supervisor restart it. Defaults to
   * `onError`.
   */
  onConnectionLost?: (error: Error) => void;
};

/**
 * Connects to RabbitMQ and returns a `QueueClient` backed by durable queues.
 *
 * Each queue `q` has a dead-letter queue `q.dlq` and one retry queue per backoff delay, named
 * `q.retry.<delay>`. A retry queue holds a failed message until its time to live expires and then
 * routes it back to `q`. Messages are persistent and publishes wait for the broker to confirm
 * them. A delivery is acknowledged only after its retry or dead-letter copy is confirmed, so a
 * crash redelivers the message instead of losing it. Changing the backoff of an existing queue
 * creates new retry queues and leaves the old ones to drain.
 */
export async function createRabbitMqQueue(options: RabbitMqQueueOptions): Promise<QueueClient> {
  const reportError = options.onError ?? ((error: Error) => console.error(error));
  const reportConnectionLost = options.onConnectionLost ?? reportError;
  const connection = await connect(options.url);
  const publisher = await connection.createConfirmChannel();
  const declared = new Set<string>();
  const consumers = new Set<Consumer>();
  let closing = false;

  connection.on("error", (error: Error) => {
    if (!closing) {
      reportConnectionLost(error);
    }
  });
  connection.on("close", (error?: Error) => {
    if (!closing) {
      reportConnectionLost(error ?? new Error("The RabbitMQ connection closed unexpectedly"));
    }
  });

  async function declare(name: string, args?: Options.AssertQueue["arguments"]): Promise<void> {
    if (declared.has(name)) {
      return;
    }

    await publisher.assertQueue(name, { durable: true, arguments: args });
    declared.add(name);
  }

  async function declareQueue(queue: string): Promise<void> {
    await declare(deadLetterQueueName(queue));
    await declare(queue);
  }

  async function declareRetryQueue(queue: string, delayMs: number): Promise<void> {
    await declare(retryQueueName(queue, delayMs), {
      "x-message-ttl": delayMs,
      "x-dead-letter-exchange": "",
      "x-dead-letter-routing-key": queue,
    });
  }

  return {
    async publish<T>(queue: string, payload: T, publishOptions: PublishOptions = {}) {
      const id = randomUUID();
      const idempotencyKey = publishOptions.idempotencyKey ?? id;

      await declareQueue(queue);
      await send(publisher, queue, Buffer.from(JSON.stringify(payload)), {
        messageId: id,
        headers: { [ATTEMPT_HEADER]: 1, [IDEMPOTENCY_KEY_HEADER]: idempotencyKey },
      });

      return { id, queue, payload, attempt: 1, idempotencyKey };
    },

    async consume<T = unknown>(
      queue: string,
      handler: MessageHandler<T>,
      consumeOptions?: ConsumeOptions,
    ) {
      const resolved = resolveConsumeOptions(consumeOptions);

      await declareQueue(queue);

      for (let attempt = 1; attempt < resolved.maxAttempts; attempt += 1) {
        await declareRetryQueue(queue, getBackoffDelayMs(resolved.backoff, attempt));
      }

      const channel = await connection.createChannel();
      const controller = new AbortController();
      const inFlight = new Set<Promise<void>>();
      let stopping = false;

      await channel.prefetch(resolved.concurrency);

      /**
       * Settles a delivery whose handler threw. The retry or dead-letter copy is confirmed by
       * the broker before the original is acknowledged.
       */
      async function settleFailure(
        delivery: ConsumeMessage,
        message: QueueMessage<T>,
        error: unknown,
      ): Promise<void> {
        const plan = planFailure(error, message.attempt, resolved);
        const isRetry = plan.kind === "retry";

        const target = isRetry ? retryQueueName(queue, plan.delayMs) : deadLetterQueueName(queue);

        await send(publisher, target, delivery.content, {
          messageId: message.id,
          headers: {
            [ATTEMPT_HEADER]: isRetry ? message.attempt + 1 : message.attempt,
            [IDEMPOTENCY_KEY_HEADER]: message.idempotencyKey,
            [LAST_ERROR_HEADER]: describeError(error),
          },
        });
        channel.ack(delivery);
      }

      async function handleDelivery(delivery: ConsumeMessage): Promise<void> {
        const message = parseDelivery<T>(queue, delivery);

        if (!message) {
          await send(publisher, deadLetterQueueName(queue), delivery.content, {
            messageId: delivery.properties.messageId,
            headers: { [LAST_ERROR_HEADER]: "The message is not valid JSON" },
          });
          channel.ack(delivery);

          return;
        }

        try {
          await handler(message, { signal: controller.signal });
        } catch (error) {
          if (stopping) {
            channel.nack(delivery, false, true);

            return;
          }

          await settleFailure(delivery, message, error);

          return;
        }

        channel.ack(delivery);
      }

      /**
       * Runs the delivery to completion in the background. When it cannot be settled, for example
       * because the broker did not confirm the retry copy, it is requeued so that it is delivered
       * again.
       */
      function track(delivery: ConsumeMessage): void {
        const task: Promise<void> = handleDelivery(delivery)
          .catch((error: unknown) => {
            reportError(error instanceof Error ? error : new Error(String(error)));
            channel.nack(delivery, false, true);
          })
          .finally(() => inFlight.delete(task));

        inFlight.add(task);
      }

      const { consumerTag } = await channel.consume(queue, (delivery) => {
        if (delivery) {
          track(delivery);
        }
      });

      const consumer: Consumer = {
        async stop() {
          if (stopping) {
            return;
          }

          stopping = true;
          consumers.delete(consumer);
          await channel.cancel(consumerTag);
          controller.abort();
          await Promise.allSettled(inFlight);
          await channel.close();
        },
      };

      consumers.add(consumer);

      return consumer;
    },

    async close() {
      closing = true;
      await Promise.all([...consumers].map((consumer) => consumer.stop()));
      await publisher.close();
      await connection.close();
    },
  };
}

function parseDelivery<T>(queue: string, delivery: ConsumeMessage): QueueMessage<T> | null {
  const { headers, messageId } = delivery.properties;
  const lastError = headers?.[LAST_ERROR_HEADER];

  const id = messageId ?? randomUUID();

  try {
    const payload = JSON.parse(delivery.content.toString("utf8")) as T;

    return {
      id,
      queue,
      payload,
      attempt: Number(headers?.[ATTEMPT_HEADER] ?? 1),
      idempotencyKey: String(headers?.[IDEMPOTENCY_KEY_HEADER] ?? id),
      lastError: typeof lastError === "string" ? lastError : undefined,
    };
  } catch {
    return null;
  }
}

function send(
  channel: ConfirmChannel,
  queue: string,
  content: Buffer,
  properties: Options.Publish,
): Promise<void> {
  return new Promise((resolve, reject) => {
    channel.sendToQueue(
      queue,
      content,
      { persistent: true, contentType: "application/json", ...properties },
      (error) => (error ? reject(error) : resolve()),
    );
  });
}
