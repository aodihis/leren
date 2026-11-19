import { MemoryQueue } from "./queue/memory.js";
import { Worker } from "./worker.js";

const queue = new MemoryQueue();
const worker = new Worker({ queue });

worker.start();

console.log("Worker started");

await queue.enqueue("example", { message: "hello from the worker" });

const shutdown = async () => {
  console.log("Shutting down worker...");
  await worker.stop();
  process.exit(0);
};

process.on("SIGINT", shutdown);

process.on("SIGTERM", shutdown);
