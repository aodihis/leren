/** Backoff between delivery attempts. */
export type BackoffPolicy = {
  initialDelayMs: number;
  factor: number;
  maxDelayMs: number;
};

export type PublishOptions = {
  /** Identifies the unit of work of a message. */
  idempotencyKey?: string;
};

export type ConsumeOptions = {
  /** Total delivery attempts before dead-lettering. */
  maxAttempts?: number;
  /** Delay between attempts. */
  backoff?: BackoffPolicy;
  /** Messages handled at the same time. */
  concurrency?: number;
};

/** A message as seen by a handler. */
export type QueueMessage<T = unknown> = {
  id: string;
  queue: string;
  payload: T;
  attempt: number;
  idempotencyKey: string;
  lastError?: string;
};

export type HandlerContext = {
  /** Aborted when the consumer stops. */
  signal: AbortSignal;
};

/** Handles one message. */
export type MessageHandler<T = unknown> = (
  message: QueueMessage<T>,
  context: HandlerContext,
) => Promise<void>;

export type Consumer = {
  /** Stops taking messages and waits for handlers. */
  stop(): Promise<void>;
};

/** Durable named queues with retries. */
export type QueueClient = {
  publish<T>(queue: string, payload: T, options?: PublishOptions): Promise<QueueMessage<T>>;
  consume<T = unknown>(
    queue: string,
    handler: MessageHandler<T>,
    options?: ConsumeOptions,
  ): Promise<Consumer>;
  close(): Promise<void>;
};
