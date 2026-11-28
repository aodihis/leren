import { createMcpHandler } from "@modelcontextprotocol/server";

import { writeAudit } from "./audit";
import { verifySession } from "./sessions";
import type { McpSession, SessionDependencies } from "./sessions";
import { createMcpServer } from "./tools";
import type { McpToolDependencies } from "./tools";

/**
 * Decides whether a verified session may make a call. `tool` is the name of the tool for a
 * `tools/call` request and `null` for any other request. A refusal answers `429`, or `503` when
 * `unavailable` is set because the limit could not be checked.
 */
export type McpRateLimit = (call: {
  session: McpSession;
  tool: string | null;
}) => Promise<
  { allowed: true } | { allowed: false; retryAfterSeconds: number; unavailable?: boolean }
>;

export type McpEndpointDependencies = SessionDependencies &
  Omit<McpToolDependencies, "db" | "onToolAudited"> & {
    /** Limits the calls of a session. A request that it refuses receives `429`. */
    rateLimit?: McpRateLimit;
  };

function unauthorized(): Response {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { "content-type": "application/json", "www-authenticate": "Bearer" },
  });
}

function refused(retryAfterSeconds: number, unavailable: boolean): Response {
  return new Response(
    JSON.stringify({ error: unavailable ? "Service unavailable" : "Too many requests" }),
    {
      status: unavailable ? 503 : 429,
      headers: { "content-type": "application/json", "retry-after": String(retryAfterSeconds) },
    },
  );
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

function toolCallName(message: unknown): string | null {
  const { method, params } = (message ?? {}) as { method?: unknown; params?: { name?: unknown } };

  return method === "tools/call" && typeof params?.name === "string" ? params.name : null;
}

/**
 * Returns one entry for each JSON-RPC message in the request: the tool name of a `tools/call`, or
 * `null`. A batch has one entry per message, so it cannot count as a single call. The body is read
 * from a clone, so the SDK still receives the original.
 */
async function readToolCallNames(request: Request): Promise<(string | null)[]> {
  const body: unknown = await request
    .clone()
    .json()
    .catch(() => null);

  return Array.isArray(body) && body.length > 0 ? body.map(toolCallName) : [toolCallName(body)];
}

/**
 * Creates the MCP endpoint's fetch handler. Each request needs a bearer token that `verifySession`
 * accepts and gets a server built for that session alone. Invalid tokens get `401`, and
 * rate-limited calls get `429` or `503`. Calls the SDK rejects are audited as `rejected`;
 * rate-limited calls are not.
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

      const toolNames = await readToolCallNames(request);
      const toolName = toolNames.length === 1 ? (toolNames[0] ?? null) : null;

      for (const tool of toolNames) {
        const decision = (await deps.rateLimit?.({ session, tool })) ?? { allowed: true };

        if (!decision.allowed) {
          return refused(decision.retryAfterSeconds, decision.unavailable === true);
        }
      }

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
