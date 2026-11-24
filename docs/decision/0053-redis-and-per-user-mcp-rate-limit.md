# 0053. Redis, and a per-user rate limit on the MCP endpoint

- Status: Accepted
- Date: 2026-11-24
- Affects: apps/api, packages/rate-limit, packages/mcp-server, docker-compose.dev.yml, .env.example, docs/rules/packages.md, docs/rules/backend.md

## Context

[0052](0052-mcp-access-tokens.md) lets a user connect their own agent to `/mcp` with an access token, which makes the endpoint reachable from the public internet. A limit by IP address at the reverse proxy would count every user behind one address together, so the limit must be by account. A per-account counter must be shared by every API process and survive a restart, which an in-process counter cannot do.

## Decision

- Add Redis as infrastructure. The development stack runs `redis:7-alpine` in `docker-compose.dev.yml` on port 56379 with append-only persistence, and the API reads its address from the required variable `REDIS_URL`. Redis may later hold caches and sessions, and each such use needs its own decision. Every key of this use starts with `rate-limit:`.
- Add `@leren/rate-limit`. Its `RateLimiter` counts calls per key in a fixed window that starts at the first call. `createRedisRateLimiter` increments the counter and sets its expiry in one Lua script, so the count is atomic across processes. `@leren/rate-limit/testing` provides an in-memory limiter for tests, and both limiters pass one contract test.
- `@leren/mcp-server` takes an optional `rateLimit` function. It runs after the token is verified and before any MCP processing, and a refusal answers `429` with `Retry-After`. The package does not depend on Redis.
- `apps/api` builds that function. It limits by user id and not by token, so more tokens do not raise the limit, and each user has their own count. A user may make 120 requests a minute, and at most 20 of them may be calls to `create_playbook` or `update_playbook`. A write counts against both limits.
- Only access tokens that a user created are limited. The sessions of the built-in agents have no name and are not limited, because the reply pipeline makes many calls for one user by design.
- When Redis is unavailable, a call with an access token is refused with `503` and `Retry-After`, and the API logs an error. The limit protects the service from abuse, so it fails closed. The sessions of the built-in agents do not use the limiter, so the assistant and the reply pipeline keep working.
- A refused call is not written to the audit log, so a flood of refused calls cannot grow the table. The request log records each `429`.

## Consequences

- A fixed window allows up to twice the limit across the boundary of two windows. This is acceptable for protecting the service, and a sliding window can replace it behind the same interface.
- While Redis is down, access tokens cannot be used, and an operator should alert on the logged error.
- Requests with a missing or invalid token cannot be tied to a user and are not limited here. Their rejection costs a signature check and, for a valid signature, one database read, so a loose limit by IP address at the proxy remains useful for them.
- The limits are constants in `apps/api/src/modules/mcp/rate-limit.ts`. Making them configurable is a later change.
- Every environment that runs the API needs `REDIS_URL`.
