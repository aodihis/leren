import { randomUUID } from "node:crypto";
import type { JobRecord, Queue } from "./types.js";

export class MemoryQueue implements Queue {
  private jobs: JobRecord[] = [];

  async enqueue<T>(name: string, payload: T): Promise<JobRecord<T>> {
    const job: JobRecord<T> = { id: randomUUID(), name, payload, attempts: 0 };
    this.jobs.push(job);

    return job;
  }

  async dequeue(): Promise<JobRecord | null> {
    return this.jobs.shift() ?? null;
  }

  async retry(job: JobRecord): Promise<void> {
    this.jobs.push(job);
  }
}
