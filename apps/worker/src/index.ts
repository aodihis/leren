import { loadHarness, resolveEmbeddingModel } from "@leren/agents";
import { createChannelProviders, parseEncryptionKey } from "@leren/channels";
import { createDb } from "@leren/db";
import { createEmbedder } from "@leren/embedder";
import { createObserver } from "@leren/observability";
import { createRabbitMqQueue } from "@leren/queue";
import { createVectorStore } from "@leren/vector-db";

import harness from "../../../harness.config";
import { loadConfig } from "./config";
import { logger } from "./logger";
import { createJobs } from "./modules";
import { requestEmailPolls } from "./modules/email-poll/job";
import { KNOWLEDGE_DRIFT_QUEUE } from "./modules/knowledge-index/job";
import { createPipelineRunner } from "./modules/reply-run/pipeline";
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

/**
 * The one observer of the process. It batches telemetry, so it is flushed after each reply run and
 * closed when the process stops, or the last batch is lost.
 */
const observer = createObserver();

/**
 * Builds what the reply pipeline needs. The reply pipeline is optional, so a deployment whose
 * models, prompt or MCP session secret are not configured still runs every other job, and the
 * messages that the gate queued wait in the queue.
 */
async function createReplyRun() {
  try {
    if (!config.MCP_SESSION_SECRET) {
      throw new Error("MCP_SESSION_SECRET is not set");
    }

    const loaded = await loadHarness();

    return {
      db,
      observer,
      sessions: { db, secret: config.MCP_SESSION_SECRET },
      runPipeline: createPipelineRunner({
        models: {
          triage: loaded.createModel("replyTriage"),
          draft: loaded.createModel("reply"),
          judge: loaded.createModel("replyJudge"),
        },
        rules: await loaded.readPrompt("reply"),
        observer,
        mcpUrl: config.MCP_URL,
      }),
    };
  } catch (error) {
    logger.warn("The reply pipeline is disabled", { error });

    return undefined;
  }
}

const channels = {
  providers: createChannelProviders(config),
  encryptionKey: config.CHANNEL_TOKEN_ENCRYPTION_KEY
    ? parseEncryptionKey(config.CHANNEL_TOKEN_ENCRYPTION_KEY)
    : undefined,
};

const jobs = createJobs({
  queue,
  db,
  reply: await createReplyRun(),
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
  await observer.close();
  process.exit(0);
};

process.on("SIGINT", shutdown);

process.on("SIGTERM", shutdown);
