import { createMcpHandler } from "@modelcontextprotocol/server";

import { verifySession } from "./sessions";
import type { McpSession, SessionDependencies } from "./sessions";
import { createMcpServer } from "./tools";
import type { McpToolDependencies } from "./tools";

export type McpEndpointDependencies = SessionDependencies & Omit<McpToolDependencies, "db">;

function unauthorized(): Response {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { "content-type": "application/json", "www-authenticate": "Bearer" },
  });
}

function readBearerToken(request: Request): string | null {
  const [scheme, token] = (request.headers.get("authorization") ?? "").split(" ");

  return scheme?.toLowerCase() === "bearer" && token ? token : null;
}

function readSession(extra: Record<string, unknown> | undefined): McpSession | undefined {
  return extra?.session as McpSession | undefined;
}

/**
 * Creates the fetch handler of the MCP endpoint. Every request must carry a bearer token that
 * `verifySession` accepts, and the server that answers it is built for that session alone, so one
 * request can never act for another user. A request without a valid token receives `401` before
 * any MCP processing.
 */
export function createMcpEndpoint(deps: McpEndpointDependencies) {
  const handler = createMcpHandler(({ authInfo }) => {
    const session = readSession(authInfo?.extra);

    if (!session) {
      throw new Error("The MCP request has no verified session");
    }

    return createMcpServer(session, deps);
  });

  return {
    async fetch(request: Request): Promise<Response> {
      const token = readBearerToken(request);
      const session = token ? await verifySession(deps, token) : null;

      if (!token || !session) {
        return unauthorized();
      }

      return handler.fetch(request, {
        authInfo: {
          token,
          clientId: session.role,
          scopes: [...session.scopes],
          extra: { session },
        },
      });
    },
    close: () => handler.close(),
  };
}
