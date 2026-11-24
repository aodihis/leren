import type { BackoffPolicy } from "@leren/queue";
import type { ZodType } from "zod";

export type JobContext = {
  jobId: string;
  /** The delivery attempt, starting at 1. */
  attempt: number;
  idempotencyKey: string;
  /** Aborted when the worker stops during a job. */
  signal: AbortSignal;
};

/** A unit of background work. */
export type JobDefinition<T = unknown> = {
  name: string;
  /** Validates the payload before the handler runs. */
  schema: ZodType<T>;
  maxAttempts?: number;
  backoff?: BackoffPolicy;
  concurrency?: number;
  handler(payload: T, context: JobContext): Promise<void>;
};

export function defineJob<T>(job: JobDefinition<T>): JobDefinition<T> {
  return job;
}
