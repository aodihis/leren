import type { Db } from "@leren/db";
import type { Logger } from "@leren/logger";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "./app";
import type { Auth } from "./modules/auth/service";

/**
 * The routes under test never touch the auth service or the database, so inert stand-ins are enough.
 * The request logger is a spy because logging each completed request is part of the app's contract.
 */
const MCP_SECRET = "an-mcp-test-secret-of-at-least-32-chars";

function createTestApp() {
  const requestLogger: Logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  };

  const logger: Logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnValue(requestLogger),
  };

  const app = createApp({
    auth: {} as Auth,
    db: {} as Db,
    logger,
    requestKnowledgeIndex: vi.fn(),
    mcp: { secret: MCP_SECRET },
  });

  return { app, logger, requestLogger };
}

describe("createApp", () => {
  it.each([
    ["/", { name: "leren-api" }],
    ["/health", { status: "ok" }],
  ])("answers GET %s with its public body", async (path, body) => {
    const { app } = createTestApp();

    const response = await app.request(path);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(body);
  });

  it("echoes a valid message", async () => {
    const { app } = createTestApp();

    const response = await app.request("/echo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "hello" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ message: "hello" });
  });

  it("rejects an empty message", async () => {
    const { app } = createTestApp();

    const response = await app.request("/echo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "" }),
    });

    expect(response.status).toBe(400);
  });

  it("logs each completed request with the request id, method, path and status", async () => {
    const { app, logger, requestLogger } = createTestApp();

    await app.request("/health", { headers: { "x-request-id": "req-1" } });

    expect(logger.child).toHaveBeenCalledExactlyOnceWith({ requestId: "req-1" });
    expect(requestLogger.info).toHaveBeenCalledExactlyOnceWith("Request completed", {
      method: "GET",
      path: "/health",
      status: 200,
    });
  });
});
