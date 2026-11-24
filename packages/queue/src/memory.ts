import { randomUUID } from "node:crypto";

import { resolveConsumeOptions } from "./backoff";
import type { ResolvedConsumeOptions } from "./backoff";
import { describeError } from "./errors";
import { deadLetterQueueName } from "./names";
import { planFailure } from "./retry";
import type {
  Consumer,
  ConsumeOptions,
  MessageHandler,
  PublishOptions,
  QueueClient,
  QueueMessage,
} from "./types";

type Subscription = {
  handler: MessageHandler;
  options: ResolvedConsumeOptions;
  controller: AbortController;
  active: number;
  stopped: boolean;
  idleWaiters: Array<() => void>;
};

type Queue = {
  messages: QueueMessage[];
  subscriptions: Set<Subscription>;
};

/** Resolves once no handler is running. */
function whenIdle(subscription: Subscription): Promise<void> {
  if (subscription.active === 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    subscription.idleWaiters.push(resolve);
  });
}

/** Creates an in-memory QueueClient for tests. */
export function createInMemoryQueue(): QueueClient {
  const queues = new Map<string, Queue>();
  const timers = new Set<NodeJS.Timeout>();
  const subscriptions = new Set<Subscription>();

  function getQueue(name: string): Queue {
    const existing = queues.get(name);

    if (existing) {
      return existing;
    }

    const created: Queue = { messages: [], subscriptions: new Set() };

    queues.set(name, created);

    return created;
  }

  function enqueue(name: string, message: QueueMessage, position: "head" | "tail" = "tail"): void {
    const queue = getQueue(name);

    if (position === "head") {
      queue.messages.unshift(message);
    } else {
      queue.messages.push(message);
    }

    queueMicrotask(() => dispatch(name));
  }

  function dispatch(name: string): void {
    const queue = getQueue(name);

    for (const subscription of queue.subscriptions) {
      while (
        !subscription.stopped &&
        subscription.active < subscription.options.concurrency &&
        queue.messages.length > 0
      ) {
        const message = queue.messages.shift() as QueueMessage;

        subscription.active += 1;
        void deliver(name, subscription, message);
      }
    }
  }

  async function deliver(
    name: string,
    subscription: Subscription,
    message: QueueMessage,
  ): Promise<void> {
    try {
      await subscription.handler(message, { signal: subscription.controller.signal });
    } catch (error) {
      if (subscription.stopped) {
        enqueue(name, message, "head");
      } else {
        fail(name, subscription, message, error);
      }
    } finally {
      subscription.active -= 1;

      if (subscription.active === 0) {
        subscription.idleWaiters.splice(0).forEach((resolve) => resolve());
      }

      dispatch(name);
    }
  }

  function fail(
    name: string,
    subscription: Subscription,
    message: QueueMessage,
    error: unknown,
  ): void {
    const plan = planFailure(error, message.attempt, subscription.options);
    const lastError = describeError(error);

    if (plan.kind === "dead-letter") {
      enqueue(deadLetterQueueName(name), { ...message, lastError });

      return;
    }

    const timer = setTimeout(() => {
      timers.delete(timer);
      enqueue(name, { ...message, attempt: message.attempt + 1, lastError });
    }, plan.delayMs);

    timers.add(timer);
  }

  return {
    async publish<T>(name: string, payload: T, publishOptions: PublishOptions = {}) {
      const id = randomUUID();

      const message: QueueMessage<T> = {
        id,
        queue: name,
        payload: JSON.parse(JSON.stringify(payload)) as T,
        attempt: 1,
        idempotencyKey: publishOptions.idempotencyKey ?? id,
      };

      getQueue(deadLetterQueueName(name));
      enqueue(name, message);

      return message;
    },

    async consume<T = unknown>(
      name: string,
      handler: MessageHandler<T>,
      consumeOptions?: ConsumeOptions,
    ) {
      const subscription: Subscription = {
        handler: handler as MessageHandler,
        options: resolveConsumeOptions(consumeOptions),
        controller: new AbortController(),
        active: 0,
        stopped: false,
        idleWaiters: [],
      };

      getQueue(name).subscriptions.add(subscription);
      subscriptions.add(subscription);
      queueMicrotask(() => dispatch(name));

      const consumer: Consumer = {
        async stop() {
          if (subscription.stopped) {
            return;
          }

          subscription.stopped = true;
          subscription.controller.abort();
          getQueue(name).subscriptions.delete(subscription);

          await whenIdle(subscription);
        },
      };

      return consumer;
    },

    async close() {
      for (const timer of timers) {
        clearTimeout(timer);
      }

      timers.clear();
      await Promise.all(
        [...subscriptions].map((subscription) => {
          subscription.stopped = true;
          subscription.controller.abort();

          return whenIdle(subscription);
        }),
      );
    },
  };
}
