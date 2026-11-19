export interface JobRecord<T = unknown> {
  id: string;
  name: string;
  payload: T;
  attempts: number;
}

/**
 * Queue abstraction. The in-memory implementation can be swapped for a
 * persistent backend (Redis/BullMQ, Postgres, SQS, ...) without touching jobs.
 */
export interface Queue {
  enqueue<T>(name: string, payload: T): Promise<JobRecord<T>>;
  /** Returns the next job or null when the queue is empty. */
  dequeue(): Promise<JobRecord | null>;
  /** Puts a failed job back for another attempt. */
  retry(job: JobRecord): Promise<void>;
}
