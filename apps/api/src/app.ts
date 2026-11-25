import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { Scalar } from "@scalar/hono-api-reference";
import type { Db } from "@leren/db";
import type { Logger } from "@leren/logger";
import type { RateLimiter } from "@leren/rate-limit";
import { HTTPException } from "hono/http-exception";
import { requestId } from "hono/request-id";
import { createMcpEndpoint } from "@leren/mcp-server";
import type { McpToolDependencies } from "@leren/mcp-server";

import { fieldErrorsSchema, validationHook } from "./validation";
import { NO_CONNECTORS, createConnectorsRouter } from "./modules/connectors/router";
import type { ConnectorsRouterDependencies } from "./modules/connectors/router";
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
import { createMcpRateLimit } from "./modules/mcp/rate-limit";
import { createMcpRouter } from "./modules/mcp/router";
import { NO_INBOX, createMessagesRouter } from "./modules/messages/router";
import type { MessagesRouterDependencies } from "./modules/messages/router";
import { createPlaybookMcpActions } from "./modules/playbooks/mcp-actions";
import { createPlaybooksRouter } from "./modules/playbooks/router";

const echoSchema = z.object({ message: z.string().min(1) });

const rootRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["System"],
  summary: "Name of the service",
  responses: {
    200: {
      description: "The service name.",
      content: { "application/json": { schema: z.object({ name: z.string() }) } },
    },
  },
});

const healthRoute = createRoute({
  method: "get",
  path: "/health",
  tags: ["System"],
  summary: "Health check",
  responses: {
    200: {
      description: "The API is running.",
      content: { "application/json": { schema: z.object({ status: z.literal("ok") }) } },
    },
  },
});

const echoRoute = createRoute({
  method: "post",
  path: "/echo",
  tags: ["System"],
  summary: "Echo a message",
  request: { body: { required: true, content: { "application/json": { schema: echoSchema } } } },
  responses: {
    200: {
      description: "The message that was sent.",
      content: { "application/json": { schema: echoSchema } },
    },
    400: {
      description: "The message is empty.",
      content: { "application/json": { schema: fieldErrorsSchema } },
    },
  },
});

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
  connectors?: ConnectorsRouterDependencies | undefined;
  /** Records received emails for the gate. Without it, no email can be simulated. */
  inbox?: MessagesRouterDependencies | undefined;
  mcp: {
    /** Signs MCP session tokens. At least 32 characters. */
    secret: string;
    /** The retrieval collaborators of the `search_playbooks` tool. */
    search?: McpToolDependencies["search"];
    /** Limits the access tokens of users per user. Without it, no call is limited. */
    rateLimiter?: RateLimiter;
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
  connectors = NO_CONNECTORS,
  inbox = NO_INBOX,
  mcp,
}: AppDependencies) {
  const sessions = { db, secret: mcp.secret };

  const endpoint = createMcpEndpoint({
    ...sessions,
    search: mcp.search,
    rateLimit: mcp.rateLimiter && createMcpRateLimit(mcp.rateLimiter, logger),
    actions: {
      ...createPlaybookMcpActions(db, requestKnowledgeIndex),
    },
  });

  const app = new OpenAPIHono({ defaultHook: validationHook });

  app.openAPIRegistry.registerComponent("securitySchemes", "cookieAuth", {
    type: "apiKey",
    in: "cookie",
    name: "better-auth.session_token",
    description:
      "The session cookie. Deployments that use secure cookies prefix its name with `__Secure-`.",
  });

  app.use(requestId());

  app.use(async (c, next) => {
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
  });

  return app
    .openapi(rootRoute, (c) => c.json({ name: "leren-api" }, 200))
    .openapi(healthRoute, (c) => c.json({ status: "ok" as const }, 200))
    .openapi(echoRoute, (c) => c.json({ message: c.req.valid("json").message }, 200))
    .doc("/openapi.json", {
      openapi: "3.1.0",
      info: {
        title: "Leren API",
        version: "0.0.0",
        description:
          "The Leren API. Routes under `/api` need a session cookie from the sign-in flow.",
      },
    })
    .get("/scalar", Scalar({ url: "/openapi.json", pageTitle: "Leren API" }))
    .route("/", createAuthRouter(auth, db))
    .route("/", createPlaybooksRouter(auth, db, requestKnowledgeIndex))
    .route("/", createChannelAccountsRouter({ auth, db, logger, dependencies: channelAccounts }))
    .route("/", createConnectorsRouter({ auth, db, logger, dependencies: connectors }))
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
