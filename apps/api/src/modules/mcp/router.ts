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
 * Mounts the MCP endpoint at `/mcp` and the routes that manage the signed-in user's access tokens.
 * `GET` and `POST /api/mcp/tokens` list and create the access tokens that a user gives to their own
 * agent: named, long-lived sessions of the `assistant` role. The user can never choose another user,
 * role or scope. `DELETE /api/mcp/sessions/:id` revokes one of the user's own sessions. No route
 * mints a session without a name, so only code inside the API and the worker can open the unnamed
 * sessions of the built-in agents. `/mcp` does not use the browser session: it accepts only a bearer
 * token.
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
