import { serve } from "@hono/node-server";
import { loadHarness, resolveEmbeddingModel } from "@leren/agents";
import { createDb } from "@leren/db";
import { createSmtpEmailSender } from "@leren/email";
import { createEmbedder } from "@leren/embedder";
import { recordInboundEmail } from "@leren/inbox";
import { createLogger } from "@leren/logger";
import { createObserver } from "@leren/observability";
import { createRabbitMqQueue } from "@leren/queue";
import { createVectorStore } from "@leren/vector-db";

import harness from "../../../harness.config";
import { createApp } from "./app";
import type { AppType } from "./app";
import { loadConfig } from "./config";
import { createAgent } from "./modules/assistant/agent";
import { createAuth } from "./modules/auth/service";
import { parseEncryptionKey } from "./modules/channel-accounts/crypto";
import { createChannelProviders } from "./modules/channel-accounts/providers";
import { createKnowledgeIndexRequester } from "./modules/playbooks/indexing";

const logger = createLogger({ name: "api" });
const config = loadConfig();
const db = createDb(config.DATABASE_URL);

const queue = await createRabbitMqQueue({
  url: config.RABBITMQ_URL,
  onConnectionLost: (error) => {
    logger.fatal("Lost the RabbitMQ connection", { error });
    process.exit(1);
  },
});

const emailSender = createSmtpEmailSender({ url: config.SMTP_URL, from: config.EMAIL_FROM });

emailSender.verify().catch((error) => {
  logger.error("Cannot reach the SMTP server, so sign-in codes will not be delivered", { error });
});

const auth = createAuth({
  db,
  logger,
  secret: config.BETTER_AUTH_SECRET,
  baseURL: config.API_URL,
  trustedOrigins: [config.PLATFORM_URL],
  emailSender,
});

/**
 * Builds the collaborators of the `search_playbooks` tool. Search is optional, so a deployment
 * without an embedding key still serves every other tool.
 */
function createSearchDependencies() {
  try {
    const model = resolveEmbeddingModel(harness);

    return {
      store: createVectorStore({ url: config.VECTOR_STORE_URL }),
      embedder: createEmbedder({
        baseUrl: model.definition.baseUrl,
        apiKey: model.apiKey,
        model: model.definition.modelId,
        dimensions: model.definition.dimensions,
      }),
    };
  } catch (error) {
    logger.warn("Knowledge search is disabled for MCP", { error });

    return undefined;
  }
}

/**
 * Builds the agent of the assistant chat. The chat is optional, so a deployment whose assistant
 * model or prompt cannot be loaded still serves every other route.
 */
async function createAssistant() {
  try {
    const loaded = await loadHarness();

    return createAgent({
      sessions: { db, secret: config.MCP_SESSION_SECRET },
      mcpUrl: `http://127.0.0.1:${config.PORT}/mcp`,
      logger,
      instructions: await loaded.readPrompt("assistant"),
      model: loaded.createModel("assistant"),
      observer: createObserver(),
    });
  } catch (error) {
    logger.warn("The assistant chat is disabled", { error });

    return undefined;
  }
}

const app = createApp({
  auth,
  db,
  logger,
  requestKnowledgeIndex: createKnowledgeIndexRequester(queue, logger),
  assistant: await createAssistant(),
  channelAccounts: {
    providers: createChannelProviders(config),
    encryptionKey: config.CHANNEL_TOKEN_ENCRYPTION_KEY
      ? parseEncryptionKey(config.CHANNEL_TOKEN_ENCRYPTION_KEY)
      : undefined,
    cookieSecret: config.BETTER_AUTH_SECRET,
    apiUrl: config.API_URL,
    platformUrl: config.PLATFORM_URL,
  },
  inbox: {
    recordEmail: (email) => recordInboundEmail({ db, queue }, email),
    simulate: config.CHANNEL_PROVIDERS.includes("mailpit"),
  },
  mcp: { secret: config.MCP_SESSION_SECRET, search: createSearchDependencies() },
});

serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  logger.info("API listening", { port: info.port });
});

export type { AppType };
