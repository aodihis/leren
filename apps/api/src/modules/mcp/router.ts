import type { Db } from "@leren/db";
import { mintSession, revokeSession } from "@leren/mcp-server";
import type { SessionDependencies } from "@leren/mcp-server";
import { Hono } from "hono";

import { validate } from "../../validation";
import { requireUser } from "../auth/middleware";
import type { AuthVariables } from "../auth/middleware";
import type { Auth } from "../auth/service";
import { mcpSessionParamsSchema } from "./schema";

export type McpRouterDependencies = {
  auth: Auth;
  db: Db;
  sessions: SessionDependencies;
  /** Serves one MCP request. It authenticates the request itself with a session token. */
  endpoint: { fetch: (request: Request) => Promise<Response> };
};

/**
 * Mounts the MCP endpoint at `/mcp` and the routes that manage the signed-in user's MCP sessions.
 * `POST /api/mcp/sessions` mints an assistant session for the signed-in user, and the user can
 * never choose another user, role or scope. `DELETE /api/mcp/sessions/:id` revokes one of the
 * user's own sessions. `/mcp` does not use the browser session: it accepts only a bearer token.
 */
export function createMcpRouter({ auth, db, sessions, endpoint }: McpRouterDependencies) {
  return new Hono<{ Variables: AuthVariables }>()
    .all("/mcp", (c) => endpoint.fetch(c.req.raw))
    .use("/api/mcp/*", requireUser(auth))
    .post("/api/mcp/sessions", async (c) => {
      const minted = await mintSession(sessions, { userId: c.get("userId"), role: "assistant" });

      return c.json(
        {
          token: minted.token,
          sessionId: minted.sessionId,
          expiresAt: minted.expiresAt.toISOString(),
        },
        201,
      );
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
