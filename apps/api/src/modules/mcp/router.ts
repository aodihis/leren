import type { Db } from "@leren/db";
import { revokeSession } from "@leren/mcp-server";
import type { SessionDependencies } from "@leren/mcp-server";
import { Hono } from "hono";

import { validate } from "../../validation";
import { requireUser } from "../auth/middleware";
import type { AuthVariables } from "../auth/middleware";
import type { Auth } from "../auth/service";
import { createAccessTokenSchema, mcpSessionParamsSchema } from "./schema";
import { createAccessToken, listAccessTokens } from "./service";

export type McpRouterDependencies = {
  auth: Auth;
  db: Db;
  sessions: SessionDependencies;
  /** Serves one MCP request. It authenticates the request itself with a session token. */
  endpoint: { fetch: (request: Request) => Promise<Response> };
};

/**
 * Mounts the MCP endpoint at `/mcp` and the routes that manage the user's access tokens. A user can
 * create, list and revoke only their own named `assistant` sessions. No route mints an unnamed
 * session, which only the built-in agents use. `/mcp` accepts only a bearer token.
 */
export function createMcpRouter({ auth, db, sessions, endpoint }: McpRouterDependencies) {
  return new Hono<{ Variables: AuthVariables }>()
    .all("/mcp", (c) => endpoint.fetch(c.req.raw))
    .use("/api/mcp/*", requireUser(auth))
    .get("/api/mcp/tokens", async (c) =>
      c.json({ tokens: await listAccessTokens(db, c.get("userId"), sessions.now?.()) }),
    )
    .post("/api/mcp/tokens", validate("json", createAccessTokenSchema), async (c) => {
      const created = await createAccessToken(sessions, c.get("userId"), c.req.valid("json"));

      if (created.status === "limit") {
        return c.json({ error: "limit" as const }, 409);
      }

      return c.json({ token: created.token, accessToken: created.view }, 201);
    })
    .delete("/api/mcp/sessions/:id", validate("param", mcpSessionParamsSchema), async (c) => {
      const revoked = await revokeSession(
        { db, now: sessions.now },
        c.get("userId"),
        c.req.valid("param").id,
      );

      return revoked ? c.body(null, 204) : c.json({ error: "Not found" }, 404);
    });
}
