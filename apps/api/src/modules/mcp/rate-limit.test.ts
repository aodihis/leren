import type { Logger } from "@leren/logger";
import type { McpSession } from "@leren/mcp-server";
import type { RateLimiter } from "@leren/rate-limit";
import { createMemoryRateLimiter } from "@leren/rate-limit/testing";
import { describe, expect, it, vi } from "vitest";

import { REQUEST_RULE, WRITE_RULE, createMcpRateLimit } from "./rate-limit";

function createLogger() {
  const error = vi.fn();

  const logger: Logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error,
    fatal: vi.fn(),
    child: () => logger,
  };

  return { logger, error };
}

function session(userId: string, name: string | null = "Agent"): McpSession {
  return { id: `session-${userId}`, userId, role: "assistant", scopes: [], messageId: null, name };
}

describe("MCP rate limit", () => {
  it("refuses a user after the request limit and reports when to retry", async () => {
    const rateLimit = createMcpRateLimit(createMemoryRateLimiter(), createLogger().logger);

    for (let call = 0; call < REQUEST_RULE.limit; call += 1) {
      expect(await rateLimit({ session: session("u1"), tool: "list_playbooks" })).toEqual({
        allowed: true,
      });
    }

    const refused = await rateLimit({ session: session("u1"), tool: "list_playbooks" });

    expect(refused).toMatchObject({ allowed: false });
    expect(refused.allowed === false && refused.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it("limits the writes of a user more tightly than the reads", async () => {
    const rateLimit = createMcpRateLimit(createMemoryRateLimiter(), createLogger().logger);

    for (let call = 0; call < WRITE_RULE.limit; call += 1) {
      await rateLimit({ session: session("u1"), tool: "create_playbook" });
    }

    expect(await rateLimit({ session: session("u1"), tool: "update_playbook" })).toMatchObject({
      allowed: false,
    });
    expect(await rateLimit({ session: session("u1"), tool: "list_playbooks" })).toEqual({
      allowed: true,
    });
  });

  it("counts a user once however many tokens they hold", async () => {
    const rateLimit = createMcpRateLimit(createMemoryRateLimiter(), createLogger().logger);
    const [first, second] = [session("u1", "A"), { ...session("u1", "B"), id: "other" }];

    for (let call = 0; call < REQUEST_RULE.limit; call += 1) {
      await rateLimit({ session: first, tool: null });
    }

    expect(await rateLimit({ session: second, tool: null })).toMatchObject({ allowed: false });
  });

  it("does not limit one user because of another", async () => {
    const rateLimit = createMcpRateLimit(createMemoryRateLimiter(), createLogger().logger);

    for (let call = 0; call < REQUEST_RULE.limit + 1; call += 1) {
      await rateLimit({ session: session("u1"), tool: null });
    }

    expect(await rateLimit({ session: session("u2"), tool: null })).toEqual({ allowed: true });
  });

  it("does not limit the sessions of the built-in agents", async () => {
    const rateLimit = createMcpRateLimit(createMemoryRateLimiter(), createLogger().logger);

    for (let call = 0; call < REQUEST_RULE.limit + 5; call += 1) {
      expect(await rateLimit({ session: session("u1", null), tool: null })).toEqual({
        allowed: true,
      });
    }
  });

  it("refuses the call and logs an error when the limiter fails", async () => {
    const { logger, error } = createLogger();

    const failing: RateLimiter = {
      consume: vi.fn().mockRejectedValue(new Error("connection refused")),
      close: vi.fn(),
    };

    expect(
      await createMcpRateLimit(failing, logger)({ session: session("u1"), tool: null }),
    ).toEqual({ allowed: false, retryAfterSeconds: 5, unavailable: true });
    expect(error).toHaveBeenCalledOnce();
  });
});
