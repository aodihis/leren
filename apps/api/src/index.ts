import { serve } from "@hono/node-server";
import { createDb } from "@leren/db";
import { createSmtpEmailSender } from "@leren/email";
import { createLogger } from "@leren/logger";
import { createRabbitMqQueue } from "@leren/queue";

import { createApp } from "./app";
import type { AppType } from "./app";
import { loadConfig } from "./config";
import { createAuth } from "./modules/auth/service";
import { createKnowledgeIndexRequester } from "./modules/knowledge-items/indexing";

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

const app = createApp({
  auth,
  db,
  logger,
  requestKnowledgeIndex: createKnowledgeIndexRequester(queue, logger),
});

serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  logger.info("API listening", { port: info.port });
});

export type { AppType };
