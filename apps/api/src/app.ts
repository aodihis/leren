import { zValidator } from "@hono/zod-validator";
import type { Db } from "@leren/db";
import type { Logger } from "@leren/logger";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { requestId } from "hono/request-id";
import { createMcpEndpoint } from "@leren/mcp-server";
import type { McpToolDependencies } from "@leren/mcp-server";
import { z } from "zod";

import { createAssistantRouter } from "./modules/assistant/router";
import type { Agent } from "./modules/assistant/agent";
import { createAuthRouter } from "./modules/auth/router";
import {
  NO_CHANNEL_PROVIDERS,
  createChannelAccountsRouter,
} from "./modules/channel-accounts/router";
import type { ChannelAccountsRouterDependencies } from "./modules/channel-accounts/router";
import type { Auth } from "./modules/auth/service";
import { createDashboardRouter } from "./modules/dashboard/router";
import { createMcpRouter } from "./modules/mcp/router";
import { NO_INBOX, createMessagesRouter } from "./modules/messages/router";
import type { MessagesRouterDependencies } from "./modules/messages/router";
import { createPlaybookMcpActions } from "./modules/playbooks/mcp-actions";
import { createPlaybooksRouter } from "./modules/playbooks/router";

const echoSchema = z.object({ message: z.string().min(1) });

export type AppDependencies = {
  auth: Auth;
  db: Db;
  logger: Logger;
  /** Asks the worker to bring the vector index of a playbook up to date. Must not throw. */
  requestKnowledgeIndex: (playbookId: string) => Promise<void>;
  /** Runs the Assistant Agent for the chat. Without it, the chat reports that it is unavailable. */
  assistant?: Agent | undefined;
  /** The enabled channel providers and their settings. Without it, no provider is enabled. */
  channelAccounts?: ChannelAccountsRouterDependencies | undefined;
  /** Records received emails for the gate. Without it, no email can be simulated. */
  inbox?: MessagesRouterDependencies | undefined;
  mcp: {
    /** Signs MCP session tokens. At least 32 characters. */
    secret: string;
    /** The retrieval collaborators of the `search_playbooks` tool. */
    search?: McpToolDependencies["search"];
  };
};

/**
 * Builds the Hono application from its collaborators, so tests can run it against a test database
 * without starting a server.
 */
export function createApp({
  auth,
  db,
  logger,
  requestKnowledgeIndex,
  assistant,
  channelAccounts = NO_CHANNEL_PROVIDERS,
  inbox = NO_INBOX,
  mcp,
}: AppDependencies) {
  const sessions = { db, secret: mcp.secret };

  const endpoint = createMcpEndpoint({
    ...sessions,
    search: mcp.search,
    actions: {
      ...createPlaybookMcpActions(db, requestKnowledgeIndex),
    },
  });

  return new Hono()
    .use(requestId())
    .use(async (c, next) => {
      const requestLogger = logger.child({ requestId: c.get("requestId") });

      await next();

      const status = c.res.status;
      const metadata = { method: c.req.method, path: c.req.path, status };

      if (status >= 500) {
        requestLogger.error("Request failed", metadata);
      } else if (status >= 400) {
        requestLogger.warn("Request rejected", metadata);
      } else {
        requestLogger.info("Request completed", metadata);
      }
    })
    .get("/", (c) => c.json({ name: "leren-api" }))
    .get("/health", (c) => c.json({ status: "ok" }))
    .post("/echo", zValidator("json", echoSchema), (c) => {
      const { message } = c.req.valid("json");

      return c.json({ message });
    })
    .route("/", createAuthRouter(auth, db))
    .route("/", createPlaybooksRouter(auth, db, requestKnowledgeIndex))
    .route("/", createChannelAccountsRouter({ auth, db, logger, dependencies: channelAccounts }))
    .route("/", createMessagesRouter({ auth, db, dependencies: inbox }))
    .route("/", createDashboardRouter(auth, db))
    .route("/", createMcpRouter({ auth, db, sessions, endpoint }))
    .route("/", createAssistantRouter({ auth, db, logger, agent: assistant }))
    .onError((error, c) => {
      if (error instanceof HTTPException) {
        return error.getResponse();
      }

      logger.error("Unhandled error", {
        requestId: c.get("requestId"),
        method: c.req.method,
        path: c.req.path,
        error,
      });

      return c.json({ error: "Something went wrong" }, 500);
    });
}

export type AppType = ReturnType<typeof createApp>;
