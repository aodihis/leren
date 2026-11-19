import type { ZodType } from "zod";

export interface JobContext {
  jobId: string;
  attempt: number;
  signal: AbortSignal;
}

export interface JobDefinition<T = any> {
  name: string;
  /** Validates the payload before the handler runs. */
  schema: ZodType<T>;
  maxAttempts?: number;
  handler(payload: T, ctx: JobContext): Promise<void>;
}

export function defineJob<T>(job: JobDefinition<T>): JobDefinition<T> {
  return job;
}
