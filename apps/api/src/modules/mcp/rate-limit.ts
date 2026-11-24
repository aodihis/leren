import type { Logger } from "@leren/logger";
import { WRITE_TOOLS } from "@leren/mcp-server";
import type { McpRateLimit } from "@leren/mcp-server";
import type { RateLimitRule, RateLimiter } from "@leren/rate-limit";

/** The most requests of any kind that one user may make in a minute through access tokens. */
export const REQUEST_RULE: RateLimitRule = { limit: 120, windowSeconds: 60 };

/** The most calls to a tool that changes data that one user may make in a minute. */
export const WRITE_RULE: RateLimitRule = { limit: 20, windowSeconds: 60 };

/** What a refused caller is told to wait when the limit cannot be checked, in seconds. */
const UNAVAILABLE_RETRY_SECONDS = 5;

const WRITE_TOOL_NAMES: readonly string[] = Object.values(WRITE_TOOLS);

/**
 * Builds the rate limit of the MCP endpoint. It limits each user and not each token or address, so
 * creating more tokens does not raise the limit and users behind one address do not share it. Only
 * access tokens that a user created are limited: the sessions of the built-in agents have no name
 * and pass, because the reply pipeline makes many calls for one user by design. A write is counted
 * against both the request limit and the write limit.
 *
 * When the limiter fails, the call is refused as unavailable and an error is logged. The limit
 * protects the service from abuse, so it fails closed. The sessions of the built-in agents do not
 * use the limiter, so an outage of the counter store does not stop them.
 */
export function createMcpRateLimit(limiter: RateLimiter, logger: Logger): McpRateLimit {
  return async ({ session, tool }) => {
    if (session.name === null) {
      return { allowed: true };
    }

    try {
      const requests = await limiter.consume(`mcp:${session.userId}:requests`, REQUEST_RULE);

      if (!requests.allowed) {
        return { allowed: false, retryAfterSeconds: requests.retryAfterSeconds };
      }

      if (tool && WRITE_TOOL_NAMES.includes(tool)) {
        const writes = await limiter.consume(`mcp:${session.userId}:writes`, WRITE_RULE);

        if (!writes.allowed) {
          return { allowed: false, retryAfterSeconds: writes.retryAfterSeconds };
        }
      }

      return { allowed: true };
    } catch (error) {
      logger.error("The MCP rate limit is unavailable, so the call was refused", { error });

      return { allowed: false, retryAfterSeconds: UNAVAILABLE_RETRY_SECONDS, unavailable: true };
    }
  };
}
