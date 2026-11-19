import { NonRetryableError } from "@leren/queue";
import type { Consumer, QueueClient } from "@leren/queue";

import type { JobDefinition } from "./job";
import { logger } from "./logger";

export type WorkerOptions = {
  queue: QueueClient;
  jobs: JobDefinition[];
};

/**
 * Consumes the queue of every job and runs the job's handler for each message.
 *
 * A payload that does not match the job's schema can never succeed, so it is dead-lettered
 * without further attempts. Any other error is retried according to the job's retry policy.
 */
export class Worker {
  private consumers: Consumer[] = [];

  constructor(private readonly options: WorkerOptions) {}

  async start(): Promise<void> {
    const { queue, jobs } = this.options;

    for (const job of jobs) {
      const consumer = await queue.consume(
        job.name,
        async (message, { signal }) => {
          const parsed = job.schema.safeParse(message.payload);

          if (!parsed.success) {
            throw new NonRetryableError(
              `Invalid payload for job "${job.name}": ${parsed.error.message}`,
            );
          }

          try {
            await job.handler(parsed.data, {
              jobId: message.id,
              attempt: message.attempt,
              idempotencyKey: message.idempotencyKey,
              signal,
            });
          } catch (error) {
            logger.child({ job: job.name, jobId: message.id }).error("Job failed", { error });

            throw error;
          }
        },
        { maxAttempts: job.maxAttempts, backoff: job.backoff, concurrency: job.concurrency },
      );

      this.consumers.push(consumer);
    }
  }

  async stop(): Promise<void> {
    const consumers = this.consumers;

    this.consumers = [];
    await Promise.all(consumers.map((consumer) => consumer.stop()));
  }
}
