import { randomBytes } from "node:crypto";

import type { ConnectorsDependencies } from "@leren/connectors";
import type { Db } from "@leren/db";
import type { Logger } from "@leren/logger";
import { Hono } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import { z } from "zod";

import { codeChallengeOf, parseJson } from "../../oauth";
import { validate } from "../../validation";
import { requireUser } from "../auth/middleware";
import type { AuthVariables } from "../auth/middleware";
import type { Auth } from "../auth/service";
import { callbackQuerySchema, connectorParamsSchema } from "./schema";
import type { ConnectionErrorCode } from "./schema";
import {
  disconnectConnector,
  listAvailableConnectors,
  listConnections,
  saveConnection,
} from "./service";

const STATE_COOKIE = "connector_oauth";
const STATE_COOKIE_PATH = "/api/connectors";
const STATE_MAX_AGE_SECONDS = 600;
const PLATFORM_PAGE = "/connectors";

const pendingConnectionSchema = z.object({
  state: z.string(),
  codeVerifier: z.string(),
  clientId: z.string(),
  userId: z.string(),
  connector: z.string(),
});

/**
 * What the router needs beyond the connector functions. `cookieSecret` signs the cookie that holds
 * a pending connection. `apiUrl` is the origin that authorization servers redirect back to and
 * `platformUrl` is where the callback sends the browser afterwards.
 */
export type ConnectorsRouterDependencies = ConnectorsDependencies & {
  cookieSecret: string;
  apiUrl: string;
  platformUrl: string;
};

/**
 * The dependencies of an API without any enabled connector. Every connector route answers with
 * not found, so the other values are never used.
 */
export const NO_CONNECTORS: ConnectorsRouterDependencies = {
  connectors: new Map(),
  encryptionKey: undefined,
  cookieSecret: "",
  apiUrl: "",
  platformUrl: "",
};

/**
 * Mounts the routes of connectors under `/api/connectors` (decision 0054). Every route, including
 * the callback, requires a session and is scoped to the signed-in user. A connector that is not
 * enabled is reported as not found.
 *
 * A connection is kept between the connect request and the callback in a signed, `httpOnly`
 * cookie that expires after ten minutes. It holds the random `state` value, the PKCE code verifier,
 * the user and the connector. The callback accepts a request only when the cookie is present, its
 * `state` equals the query's and the session's user is the cookie's user. The cookie is cleared on
 * every callback, so a `state` value is used once. Tokens are never logged.
 */
export function createConnectorsRouter({
  auth,
  db,
  logger,
  dependencies,
}: {
  auth: Auth;
  db: Db;
  logger: Logger;
  dependencies: ConnectorsRouterDependencies;
}) {
  const redirectUriOf = (connector: string) =>
    `${dependencies.apiUrl}/api/connectors/${connector}/callback`;

  const secure = dependencies.apiUrl.startsWith("https://");

  const backToPlatform = (query: Record<string, string>) =>
    `${dependencies.platformUrl}${PLATFORM_PAGE}?${new URLSearchParams(query).toString()}`;

  const failure = (code: ConnectionErrorCode) => backToPlatform({ error: code });

  return new Hono<{ Variables: AuthVariables }>()
    .use("/api/connectors/*", requireUser(auth))
    .use("/api/connectors", requireUser(auth))
    .get("/api/connectors", async (c) => {
      const connections = await listConnections(db, c.get("userId"));

      return c.json({ available: listAvailableConnectors(dependencies), connections }, 200);
    })
    .post(
      "/api/connectors/:connector/connect",
      validate("param", connectorParamsSchema),
      async (c) => {
        const connector = dependencies.connectors.get(c.req.valid("param").connector);

        if (!connector) {
          return c.json({ error: "Not found" }, 404);
        }

        const state = randomBytes(24).toString("base64url");
        const codeVerifier = randomBytes(32).toString("base64url");

        let started: { url: string; clientId: string };

        try {
          started = await connector.start({
            state,
            codeChallenge: codeChallengeOf(codeVerifier),
            redirectUri: redirectUriOf(connector.definition.id),
          });
        } catch (caught) {
          logger.error("Starting a connector connection failed", {
            connector: connector.definition.id,
            error: caught,
          });

          return c.json({ error: "Unavailable" }, 502);
        }

        await setSignedCookie(
          c,
          STATE_COOKIE,
          JSON.stringify({
            state,
            codeVerifier,
            clientId: started.clientId,
            userId: c.get("userId"),
            connector: connector.definition.id,
          }),
          dependencies.cookieSecret,
          {
            httpOnly: true,
            sameSite: "Lax",
            secure,
            path: STATE_COOKIE_PATH,
            maxAge: STATE_MAX_AGE_SECONDS,
          },
        );

        return c.json({ status: "redirect" as const, url: started.url }, 200);
      },
    )
    .get(
      "/api/connectors/:connector/callback",
      validate("param", connectorParamsSchema),
      validate("query", callbackQuerySchema),
      async (c) => {
        const connector = dependencies.connectors.get(c.req.valid("param").connector);

        if (!connector) {
          return c.json({ error: "Not found" }, 404);
        }

        const { code, state, error } = c.req.valid("query");
        const raw = await getSignedCookie(c, dependencies.cookieSecret, STATE_COOKIE);

        deleteCookie(c, STATE_COOKIE, { path: STATE_COOKIE_PATH, secure });

        const pending = pendingConnectionSchema.safeParse(
          typeof raw === "string" ? parseJson(raw) : undefined,
        );

        if (
          !pending.success ||
          pending.data.state !== state ||
          pending.data.connector !== connector.definition.id ||
          pending.data.userId !== c.get("userId")
        ) {
          return c.redirect(failure("invalid_state"));
        }

        if (error || !code) {
          return c.redirect(failure("denied"));
        }

        try {
          const authorised = await connector.finish({
            code,
            codeVerifier: pending.data.codeVerifier,
            clientId: pending.data.clientId,
            redirectUri: redirectUriOf(connector.definition.id),
          });

          await saveConnection(db, dependencies, c.get("userId"), connector, authorised);

          return c.redirect(backToPlatform({ connected: connector.definition.id }));
        } catch (caught) {
          logger.error("Connecting a connector failed", {
            connector: connector.definition.id,
            error: caught,
          });

          return c.redirect(failure("failed"));
        }
      },
    )
    .delete("/api/connectors/:connector", validate("param", connectorParamsSchema), async (c) => {
      const disconnected = await disconnectConnector(
        db,
        dependencies,
        logger,
        c.get("userId"),
        c.req.valid("param").connector,
      );

      return disconnected ? c.body(null, 204) : c.json({ error: "Not found" }, 404);
    });
}
