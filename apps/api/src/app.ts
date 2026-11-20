import { zValidator } from "@hono/zod-validator";
import type { Db } from "@leren/db";
import type { Logger } from "@leren/logger";
import { Hono } from "hono";
import { requestId } from "hono/request-id";
import { z } from "zod";

import { createAuthRouter } from "./modules/auth/router";
import type { Auth } from "./modules/auth/service";
import { createAutoReplyRulesRouter } from "./modules/auto-reply-rules/router";
import { createContactsRouter } from "./modules/contacts/router";
import { createKnowledgeItemsRouter } from "./modules/knowledge-items/router";

const echoSchema = z.object({ message: z.string().min(1) });

export type AppDependencies = {
  auth: Auth;
  db: Db;
  logger: Logger;
};

/**
 * Builds the Hono application from its collaborators, so tests can run it against a test database
 * without starting a server.
 */
export function createApp({ auth, db, logger }: AppDependencies) {
  return new Hono()
    .use(requestId())
    .use(async (c, next) => {
      const requestLogger = logger.child({ requestId: c.get("requestId") });

      await next();

      requestLogger.info("Request completed", {
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
      });
    })
    .get("/", (c) => c.json({ name: "leren-api" }))
    .get("/health", (c) => c.json({ status: "ok" }))
    .post("/echo", zValidator("json", echoSchema), (c) => {
      const { message } = c.req.valid("json");

      return c.json({ message });
    })
    .route("/", createAuthRouter(auth, db))
    .route("/", createAutoReplyRulesRouter(auth, db))
    .route("/", createContactsRouter(auth, db))
    .route("/", createKnowledgeItemsRouter(auth, db));
}

export type AppType = ReturnType<typeof createApp>;
