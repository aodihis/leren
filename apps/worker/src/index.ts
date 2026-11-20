import { createDb } from "@leren/db";
import { createEmbedder } from "@leren/embedder";
import { createRabbitMqQueue } from "@leren/queue";
import { createVectorStore } from "@leren/vector-db";

import { loadConfig } from "./config";
import { logger } from "./logger";
import { createJobs } from "./modules";
import { KNOWLEDGE_DRIFT_QUEUE } from "./modules/knowledge-index/job";
import { Worker } from "./worker";

const config = loadConfig();

const queue = await createRabbitMqQueue({
  url: config.RABBITMQ_URL,
  onConnectionLost: (error) => {
    logger.fatal("Lost the RabbitMQ connection", { error });
    process.exit(1);
  },
});

const jobs = createJobs({
  db: createDb(config.DATABASE_URL),
  store: createVectorStore({ url: config.VECTOR_STORE_URL }),
  embedder: createEmbedder({
    baseUrl: config.EMBEDDING_BASE_URL,
    apiKey: config.EMBEDDING_API_KEY,
    model: config.EMBEDDING_MODEL,
    dimensions: config.EMBEDDING_DIMENSIONS,
  }),
});

const worker = new Worker({ queue, jobs });

await worker.start();

logger.info("Worker started", { jobs: jobs.map((job) => job.name) });

const requestDriftCheck = () => {
  queue.publish(KNOWLEDGE_DRIFT_QUEUE, {}).catch((error) => {
    logger.error("Could not request a knowledge drift check", { error });
  });
};

requestDriftCheck();

const driftTimer = setInterval(requestDriftCheck, config.KNOWLEDGE_DRIFT_INTERVAL_MINUTES * 60_000);

const shutdown = async () => {
  logger.info("Shutting down worker");
  clearInterval(driftTimer);
  await worker.stop();
  await queue.close();
  process.exit(0);
};

process.on("SIGINT", shutdown);

process.on("SIGTERM", shutdown);
