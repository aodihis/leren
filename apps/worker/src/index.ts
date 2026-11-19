import { createRabbitMqQueue } from "@leren/queue";

import { jobs } from "./modules";
import { Worker } from "./worker";

const url = process.env.RABBITMQ_URL;

if (!url) {
  throw new Error("RABBITMQ_URL is not set");
}

const queue = await createRabbitMqQueue({
  url,
  onConnectionLost: (error) => {
    console.error("Lost the RabbitMQ connection:", error);
    process.exit(1);
  },
});

const worker = new Worker({ queue, jobs });

await worker.start();

console.log(`Worker started with jobs: ${jobs.map((job) => job.name).join(", ")}`);

const shutdown = async () => {
  console.log("Shutting down worker...");
  await worker.stop();
  await queue.close();
  process.exit(0);
};

process.on("SIGINT", shutdown);

process.on("SIGTERM", shutdown);
