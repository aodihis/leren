# 0008. MCP server hosted in the API, with user-bound sessions and scopes

- Status: Accepted
- Date: 2026-11-19
- Affects: apps/api, packages/mcp-server, packages/agents, docs/rules/backend.md, docs/overview/README.md

## Context

Agents need to read and change user data. Data access must stay in one place so ownership checks are not duplicated, and a model must never be able to act on another user's data. Users may later connect their own agents instead of using the built-in assistant.

## Decision

Add `packages/mcp-server`, mounted by `apps/api`. It is the integration surface of the system.

- Tools are grouped into scopes. A session receives only the scopes granted to its client.
- The API mints a short-lived signed token for each agent run. The token carries the user id, client role, scopes, expiry and, for the Reply Agent, the message id.
- Each MCP session is bound to one user at creation. The user id is never a tool argument. Every service call and every Qdrant query filters by the session's user.
- Mutating tools validate input, accept idempotency keys, write an audit record and only create drafts or proposals. Approval is a separate human action. No tool sends email.
- Tool names and schemas are agent-neutral, so a user-owned agent can be supported later with a consent step.

## Consequences

- Authorization is enforced in one place, and it is covered by cross-user tests for every tool.
- Adding an external agent later needs a consent flow and token issuance, not a redesign.
- The MCP server must be kept in step with the services it wraps.
