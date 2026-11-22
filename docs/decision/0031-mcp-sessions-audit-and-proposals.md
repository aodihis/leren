# 0031. MCP session tokens, audit log and knowledge proposals

- Status: Superseded
- Date: 2026-11-21
- Affects: apps/api, packages/mcp-server, packages/db, docs/rules/backend.md, docs/rules/packages.md, .env.example
- Superseded by: [0032](0032-assistant-writes-with-confirmation.md)

## Context

[0008](0008-mcp-server-in-api.md) places the MCP server in the API, binds each session to one user and grants scopes. It leaves open how a token is minted and revoked, where the audit record is kept and what a mutating tool may change. The Assistant Agent must be able to suggest a change to the knowledge, but approval of knowledge stays a human action (0020).

## Decision

- A session is a row in `mcp_sessions` with the user, the client role, the granted scopes, the optional message id, the expiry and an optional revocation time. Its id is the `jti` of a signed token.
- The token is a JWT signed with HS256 by `jose`. The signing secret is `MCP_SESSION_SECRET`, which must be at least 32 characters. The token carries the user id, role, scopes, session id and expiry. The message id of a reply session is read from the session row. The server accepts a token only when the signature is valid, the expiry has not passed, and the session row exists, belongs to the same user, is not revoked and has the same scopes. A revoked or expired token is rejected on every later call, so replaying it fails.
- Roles map to a fixed set of scopes. A caller may request fewer scopes than its role allows and never more. The `assistant` role holds `knowledge:read`, `knowledge:propose` and `rules:read`. The `reply` role holds `knowledge:read` and `rules:read`, and requires a message id.
- The endpoint is `POST /mcp` on the API. The user id is read from the verified session and is never a tool argument. Every tool call checks the scope of the session and filters by the user of the session.
- Every tool call writes one row to `mcp_audit_log` with the session, user, tool name, outcome and a redacted summary of the arguments. A call that is rejected before a tool body runs, because the tool is not granted or the arguments are invalid, is recorded with the outcome `rejected` and an empty summary. The log never stores the token or a knowledge body.
- `propose_knowledge_edit` is the only mutating tool. It creates a row in `knowledge_proposals` with the status `pending` and does not change `knowledge_items`. It takes an idempotency key, and a repeated call with the same key in the same session returns the original proposal. Accepting a proposal is a separate request through the normal knowledge API, outside this decision.
- The tools are `list_rules`, `get_rule`, `list_knowledge`, `get_knowledge`, `search_knowledge` and `propose_knowledge_edit`. The server also offers the resource template `leren://knowledge/{id}` and the prompt `answer_from_knowledge`.
- `POST /api/mcp/sessions` mints a token for the signed-in user with the `assistant` role, and `DELETE /api/mcp/sessions/:id` revokes one of the user's sessions. Minting a `reply` session is a function of the package, used by the pipeline.

## Consequences

- Revocation takes effect immediately, at the cost of one database read for each MCP request.
- The audit log and the proposal table grow with use and need a retention policy before production.
- Adding a role or a scope is a change to one table in the package and needs tests for the missing-scope case.
