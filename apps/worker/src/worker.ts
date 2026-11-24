import { NonRetryableError } from "@leren/queue";
import type { Consumer, QueueClient } from "@leren/queue";

import type { JobDefinition } from "./job";
import { logger } from "./logger";

export type WorkerOptions = {
  queue: QueueClient;
  jobs: JobDefinition[];
};

/** Consumes every job queue and runs its handler. */
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
