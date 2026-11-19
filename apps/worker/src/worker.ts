import { jobRegistry } from "./jobs/index.js";
import type { Queue } from "./queue/types.js";

export interface WorkerOptions {
  queue: Queue;
  pollIntervalMs?: number;
}

export class Worker {
  private running = false;
  private controller = new AbortController();
  private loop?: Promise<void>;

  constructor(private readonly opts: WorkerOptions) {}

  start() {
    this.running = true;
    this.loop = this.run();
  }

  async stop() {
    this.running = false;
    this.controller.abort();
    await this.loop;
  }

  private async run() {
    const { queue, pollIntervalMs = 1000 } = this.opts;

    while (this.running) {
      const job = await queue.dequeue();

      if (!job) {
        await new Promise((r) => setTimeout(r, pollIntervalMs));
        continue;
      }

      const def = jobRegistry.get(job.name);

      if (!def) {
        console.error(`No handler for job "${job.name}" (${job.id})`);
        continue;
      }

      job.attempts += 1;

      try {
        const payload = def.schema.parse(job.payload);
        await def.handler(payload, {
          jobId: job.id,
          attempt: job.attempts,
          signal: this.controller.signal,
        });
      } catch (err) {
        console.error(`Job ${job.name} (${job.id}) failed:`, err);

        if (job.attempts < (def.maxAttempts ?? 1)) await queue.retry(job);
      }
    }
  }
}
