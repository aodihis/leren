# 0052. Access tokens for a user's own agent

- Status: Accepted
- Date: 2026-11-24
- Affects: apps/api, apps/platform, packages/mcp-server, packages/db, docs/overview/README.md

## Context

[0008](0008-mcp-server-in-api.md) and [0031](0031-mcp-sessions-audit-and-proposals.md) bind every MCP session to one user and leave a consent flow for user-owned agents to later work. A user who wants to connect their own agent to the `/mcp` endpoint needs a token that lasts longer than the 15 minutes of a built-in agent run, that they can name, list and revoke.

## Decision

- An access token is a session in `mcp_sessions` with the `assistant` role and a non-null `name`. The built-in agents open sessions without a name, so the two kinds are told apart by that column and the list of tokens never shows an agent run. Migration `0020_mcp_access_tokens` adds the column.
- `mintSession` takes an optional `name`. Verification, scopes, revocation and the audit log are unchanged.
- The dashboard page Agent access creates a token with a name, an access level and a lifetime of 30 days, 90 days or one year. `Read only` grants `playbooks:read`, and `Read and write` grants `playbooks:write` too. The role is the ceiling, so a token never holds more than the assistant role.
- `GET /api/mcp/tokens` lists the user's active named sessions, `POST /api/mcp/tokens` creates one and returns the signed token once, and `DELETE /api/mcp/sessions/:id` revokes it. All three use `requireUser`. The token is not stored, so it cannot be shown again.
- A user holds at most 10 active tokens. A further request is refused with `409` and `{ "error": "limit" }`.
- `/mcp` keeps accepting only a bearer token. A browser cookie is not accepted there.

## Consequences

- A token is a bearer secret that works for as long as its row is active. The user is the only party who can revoke it, and a leaked token stays valid until they do or it expires.
- An agent with a write token changes real playbooks without the confirmation step of the built-in assistant, because that step is a prompt rule of the assistant (0032). The default level is `Read only` for this reason.
- Access tokens are rate limited per user, as [0053](0053-redis-and-per-user-mcp-rate-limit.md) decides.
- The reverse proxy must forward `/mcp` to the API, as it forwards `/api`.
