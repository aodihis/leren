import { loadHarness, resolveEmbeddingModel } from "@leren/agents";
import { createChannelProviders, parseEncryptionKey } from "@leren/channels";
import { createDb } from "@leren/db";
import { EMAIL_DELIVER_QUEUE } from "@leren/inbox";
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
const roles = new Set(config.WORKER_ROLES);

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
 * Builds what the reply pipeline needs. In a process that runs other roles too, the reply pipeline
 * is optional: when its models, prompt or MCP session secret are not configured, the process still
 * runs every other job, and the messages that the gate queued wait in the queue. A process whose
 * only role is `processor` exists to run the pipeline, so there the failure stops the process at
 * startup and is not left as a warning that nobody reads.
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
      publishDeliver: async (message: { messageId: string }) => {
        await queue.publish(EMAIL_DELIVER_QUEUE, message, { idempotencyKey: message.messageId });
      },
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
    if (!roles.has("listener") && !roles.has("indexer")) {
      throw error;
    }

    logger.warn("The reply pipeline is disabled", { error });

    return undefined;
  }
}

/**
 * Builds the vector store and the embedder of the `indexer` role. They are required only when the
 * role starts, so a process without it needs no embedding model and no vector store (decision 0045).
 */
function createIndexer() {
  if (!config.VECTOR_STORE_URL) {
    throw new Error("The indexer role needs VECTOR_STORE_URL");
  }

  const embeddingModel = resolveEmbeddingModel(harness);

  return {
    store: createVectorStore({ url: config.VECTOR_STORE_URL }),
    embedder: createEmbedder({
      baseUrl: embeddingModel.definition.baseUrl,
      apiKey: embeddingModel.apiKey,
      model: embeddingModel.definition.modelId,
      dimensions: embeddingModel.definition.dimensions,
    }),
  };
}

const channels = roles.has("listener")
  ? {
      providers: createChannelProviders(config),
      encryptionKey: config.CHANNEL_TOKEN_ENCRYPTION_KEY
        ? parseEncryptionKey(config.CHANNEL_TOKEN_ENCRYPTION_KEY)
        : undefined,
    }
  : undefined;

const jobs = createJobs({
  queue,
  db,
  listener: channels
    ? { channels, pollIntervalMs: config.EMAIL_POLL_INTERVAL_SECONDS * 1000 }
    : undefined,
  processor: roles.has("processor") ? { reply: await createReplyRun() } : undefined,
  indexer: roles.has("indexer") ? createIndexer() : undefined,
});

const worker = new Worker({ queue, jobs });

await worker.start();

logger.info("Worker started", {
  roles: [...roles],
  jobs: jobs.map((job) => job.name),
});

/** The timers of the started roles. Each belongs to one role, so a process runs only its own. */
const timers: NodeJS.Timeout[] = [];

if (roles.has("indexer")) {
  const requestDriftCheck = () => {
    queue.publish(KNOWLEDGE_DRIFT_QUEUE, {}).catch((error) => {
      logger.error("Could not request a knowledge drift check", { error });
    });
  };

  requestDriftCheck();
  timers.push(setInterval(requestDriftCheck, config.KNOWLEDGE_DRIFT_INTERVAL_MINUTES * 60_000));
}

if (channels) {
  const requestMailboxPolls = () => {
    requestEmailPolls({ db, channels, queue }).catch((error) => {
      logger.error("Could not request the email polls", { error });
    });
  };

  requestMailboxPolls();
  timers.push(setInterval(requestMailboxPolls, config.EMAIL_POLL_INTERVAL_SECONDS * 1000));
}

const shutdown = async () => {
  logger.info("Shutting down worker");

  for (const timer of timers) {
    clearInterval(timer);
  }

  await worker.stop();
  await queue.close();
  await observer.close();
  process.exit(0);
};

process.on("SIGINT", shutdown);

process.on("SIGTERM", shutdown);
