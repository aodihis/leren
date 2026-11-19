/**
 * Backoff between delivery attempts. The delay before attempt `n + 1` is
 * `initialDelayMs * factor ** (n - 1)`, capped at `maxDelayMs`.
 */
export type BackoffPolicy = {
  initialDelayMs: number;
  factor: number;
  maxDelayMs: number;
};

export type PublishOptions = {
  /**
   * Identifies the unit of work the message represents. Redeliveries of the same work must reuse
   * it so that a handler can recognise a duplicate. Defaults to the message id.
   */
  idempotencyKey?: string;
};

export type ConsumeOptions = {
  /** Total delivery attempts before a message is dead-lettered. Defaults to 3. */
  maxAttempts?: number;
  /** Delay between attempts. Defaults to 1 second, doubling up to 1 minute. */
  backoff?: BackoffPolicy;
  /** Messages handled at the same time by this consumer. Defaults to 1. */
  concurrency?: number;
};

/**
 * A message as seen by a handler. `attempt` starts at 1. `lastError` is set from the second
 * attempt on and holds the message of the error that caused the previous attempt to fail.
 */
export type QueueMessage<T = unknown> = {
  id: string;
  queue: string;
  payload: T;
  attempt: number;
  idempotencyKey: string;
  lastError?: string;
};

export type HandlerContext = {
  /** Aborted when the consumer is stopped while the handler is still running. */
  signal: AbortSignal;
};

/**
 * Handles one message. Resolving acknowledges the message. Throwing schedules a retry, or
 * dead-letters the message when the attempts are used up or the error is a `NonRetryableError`.
 * Delivery is at least once, so a handler must be safe to run twice for the same message.
 */
export type MessageHandler<T = unknown> = (
  message: QueueMessage<T>,
  context: HandlerContext,
) => Promise<void>;

export type Consumer = {
  /** Stops taking new messages and waits for the handlers that are running to settle. */
  stop(): Promise<void>;
};

/**
 * Durable named queues with retries and dead-letter queues.
 *
 * The messages that exhaust their attempts are moved to the queue named `deadLetterQueueName(queue)`,
 * which can be consumed like any other queue.
 */
export type QueueClient = {
  publish<T>(queue: string, payload: T, options?: PublishOptions): Promise<QueueMessage<T>>;
  consume<T = unknown>(
    queue: string,
    handler: MessageHandler<T>,
    options?: ConsumeOptions,
  ): Promise<Consumer>;
  close(): Promise<void>;
};
