import { resolveEmbeddingModel } from "@leren/agents";
import { createChannelProviders, parseEncryptionKey } from "@leren/channels";
import { createDb } from "@leren/db";
import { createEmbedder } from "@leren/embedder";
import { createRabbitMqQueue } from "@leren/queue";
import { createVectorStore } from "@leren/vector-db";

import harness from "../../../harness.config";
import { loadConfig } from "./config";
import { logger } from "./logger";
import { createJobs } from "./modules";
import { requestEmailPolls } from "./modules/email-poll/job";
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

const db = createDb(config.DATABASE_URL);

const channels = {
  providers: createChannelProviders(config),
  encryptionKey: config.CHANNEL_TOKEN_ENCRYPTION_KEY
    ? parseEncryptionKey(config.CHANNEL_TOKEN_ENCRYPTION_KEY)
    : undefined,
};

const jobs = createJobs({
  queue,
  db,
  channels,
  pollIntervalMs: config.EMAIL_POLL_INTERVAL_SECONDS * 1000,
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

const requestMailboxPolls = () => {
  requestEmailPolls({ db, channels, queue }).catch((error) => {
    logger.error("Could not request the email polls", { error });
  });
};

requestMailboxPolls();

const pollTimer = setInterval(requestMailboxPolls, config.EMAIL_POLL_INTERVAL_SECONDS * 1000);

const shutdown = async () => {
  logger.info("Shutting down worker");
  clearInterval(driftTimer);
  clearInterval(pollTimer);
  await worker.stop();
  await queue.close();
  process.exit(0);
};

process.on("SIGINT", shutdown);

process.on("SIGTERM", shutdown);
