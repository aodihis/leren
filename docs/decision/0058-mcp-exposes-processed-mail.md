# 0058. The MCP server exposes the user's processed mail

- Status: Accepted
- Date: 2026-11-26
- Affects: packages/mcp-server, packages/assistant-agent, apps/api, apps/platform, prompts/assistant.md, docs/overview/README.md

## Context

A user, the Assistant Agent and a user's own coding agent can read and write playbooks over MCP, but only the web application shows what happened to a received email: its status, the decision of the pipeline and whether a reply was delivered. Without it an agent cannot explain why a message was escalated or which playbook is missing.

## Decision

- The MCP server has two read tools, `list_messages` and `get_message`. They need the new scope `messages:read`. The API supplies them, like the write tools, and they call the same service as the messages routes, scoped to the session's user.
- `list_messages` filters by status, outcome, failure and date, and pages with a cursor. It returns a preview of each body. `get_message` returns the full body and the decision: the reply, its category, the cited playbooks, the reasons and the delivery mode, state and error. Neither returns the raw delivery request or response. Both return `url`, the email's page in the web application.
- The `assistant` role holds `messages:read`. The `reply` role does not, so the agent that reads untrusted email can never read the user's other mail. The `read` level of an access token grants `playbooks:read` and `messages:read`. Tokens that exist already keep the scopes they were minted with and do not gain it.
- The audit log records the message id of a call and never the mail.
- The text of an email is data written by other people. The assistant's prompt treats it as data and ignores any instruction inside it.

## Consequences

- A read-only access token now exposes the content of mail to the agent that holds it, so the Agent access page says that tokens read how emails were handled.
- A user can ask the assistant why an email was escalated and which gap a new playbook would fill.
- The scope set grows by one, and a new client role must decide whether it holds it.
