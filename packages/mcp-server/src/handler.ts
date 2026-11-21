import { createMcpHandler } from "@modelcontextprotocol/server";

import { writeAudit } from "./audit";
import { verifySession } from "./sessions";
import type { McpSession, SessionDependencies } from "./sessions";
import { createMcpServer } from "./tools";
import type { McpToolDependencies } from "./tools";

export type McpEndpointDependencies = SessionDependencies &
  Omit<McpToolDependencies, "db" | "onToolAudited">;

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

/**
 * The state of one request to the endpoint. It is created per request, so nothing in it outlives
 * the request.
 */
type RequestContext = { session: McpSession; toolBodyRan: boolean };

function readContext(extra: Record<string, unknown> | undefined): RequestContext | undefined {
  return extra?.context as RequestContext | undefined;
}

/**
 * Returns the tool name of a `tools/call` request, or `null` for any other request. The body is
 * read from a clone, so the SDK still receives the original request.
 */
async function readToolCallName(request: Request): Promise<string | null> {
  const body = await request
    .clone()
    .json()
    .catch(() => null);

  return body?.method === "tools/call" && typeof body.params?.name === "string"
    ? body.params.name
    : null;
}

/**
 * Creates the fetch handler of the MCP endpoint. Every request must carry a bearer token that
 * `verifySession` accepts, and the server that answers it is built for that session alone, so one
 * request can never act for another user. A request without a valid token receives `401` before
 * any MCP processing. A `tools/call` that ends without running a tool body, because the tool is
 * not granted or its arguments fail validation, is audited here with the outcome `rejected`, so
 * denied and invalid calls appear in the log without their arguments.
 */
export function createMcpEndpoint(deps: McpEndpointDependencies) {
  const handler = createMcpHandler(({ authInfo }) => {
    const context = readContext(authInfo?.extra);

    if (!context) {
      throw new Error("The MCP request has no verified session");
    }

    return createMcpServer(context.session, {
      ...deps,
      onToolAudited: () => {
        context.toolBodyRan = true;
      },
    });
  });

  return {
    async fetch(request: Request): Promise<Response> {
      const token = readBearerToken(request);
      const session = token ? await verifySession(deps, token) : null;

      if (!token || !session) {
        return unauthorized();
      }

      const toolName = await readToolCallName(request);

      const context: RequestContext = { session, toolBodyRan: false };

      const response = await handler.fetch(request, {
        authInfo: {
          token,
          clientId: session.role,
          scopes: [...session.scopes],
          extra: { context },
        },
      });

      if (!toolName) {
        return response;
      }

      await response.clone().text();

      if (!context.toolBodyRan) {
        await writeAudit(deps.db, session, toolName, "rejected", {});
      }

      return response;
    },
    close: () => handler.close(),
  };
}
