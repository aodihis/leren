import { resolveEmbeddingModel } from "@leren/agents";
import { createDb } from "@leren/db";
import { createEmbedder } from "@leren/embedder";
import { createRabbitMqQueue } from "@leren/queue";
import { createVectorStore } from "@leren/vector-db";

import harness from "../../../harness.config";
import { loadConfig } from "./config";
import { logger } from "./logger";
import { createJobs } from "./modules";
import { KNOWLEDGE_DRIFT_QUEUE } from "./modules/knowledge-index/job";
import { Worker } from "./worker";

const config = loadConfig();
const embeddingModel = resolveEmbeddingModel(harness);

const queue = await createRabbitMqQueue({
  url: config.RABBITMQ_URL,
  onConnectionLost: (error) => {
    logger.fatal("Lost the RabbitMQ connection", { error });
    process.exit(1);
  },
});

const jobs = createJobs({
  queue,
  db: createDb(config.DATABASE_URL),
  store: createVectorStore({ url: config.VECTOR_STORE_URL }),
  embedder: createEmbedder({
    baseUrl: embeddingModel.definition.baseUrl,
    apiKey: embeddingModel.apiKey,
    model: embeddingModel.definition.modelId,
    dimensions: embeddingModel.definition.dimensions,
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
