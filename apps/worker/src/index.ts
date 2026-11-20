import { createRabbitMqQueue } from "@leren/queue";

import { logger } from "./logger";
import { jobs } from "./modules";
import { Worker } from "./worker";

const url = process.env.RABBITMQ_URL;

if (!url) {
  throw new Error("RABBITMQ_URL is not set");
}

const queue = await createRabbitMqQueue({
  url,
  onConnectionLost: (error) => {
    logger.fatal("Lost the RabbitMQ connection", { error });
    process.exit(1);
  },
});

const worker = new Worker({ queue, jobs });

await worker.start();

logger.info("Worker started", { jobs: jobs.map((job) => job.name) });

const shutdown = async () => {
  logger.info("Shutting down worker");
  await worker.stop();
  await queue.close();
  process.exit(0);
};

process.on("SIGINT", shutdown);

process.on("SIGTERM", shutdown);
