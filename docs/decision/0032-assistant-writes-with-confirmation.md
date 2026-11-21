# 0032. The Assistant Agent creates and changes rules and knowledge, with confirmation

- Status: Superseded
- Date: 2026-11-21
- Affects: packages/mcp-server, packages/agents, packages/assistant-agent, apps/api, prompts/assistant.md, docs/overview/README.md, docs/rules/backend.md
- Superseded by: [0034](0034-assistant-chat-over-anvia-protocol.md)

## Context

[0006](0006-two-agents-ui-first.md), [0008](0008-mcp-server-in-api.md) and [0031](0031-mcp-sessions-audit-and-proposals.md) limit the Assistant Agent to proposals: its only mutating tool, `propose_knowledge_edit`, saves a row in `knowledge_proposals` that the user accepts in the interface. A user can set up rules and knowledge in the web application and also wants to do it in a chat, with the assistant doing what the web form does. A proposal queue adds a second, separate path for the same change, and the web application has no screen to review it.

## Decision

- The Assistant Agent creates and changes rules and knowledge itself, through MCP tools. The tools are `create_rule`, `update_rule`, `create_knowledge` and `update_knowledge`. This replaces `propose_knowledge_edit`, the `knowledge:propose` scope and the proposal-only limit of the three decisions above.
- The scopes `knowledge:write` and `rules:write` replace `knowledge:propose`. The `assistant` role holds `knowledge:read`, `knowledge:write`, `rules:read` and `rules:write`. The `reply` role is unchanged and has no scope that changes data.
- A write tool saves through the same schema and the same service as the web API, so a rule or item saved by the assistant is the same as one saved in the interface. `apps/api` builds the write actions and passes them to `@leren/mcp-server`, because the saving rules live in the API and a package cannot import an app. Without the actions the write tools are not registered.
- Approval of knowledge stays a human action ([0020](0020-knowledge-items-and-approval.md)). The assistant has no tool that approves, archives, restores or deletes. A knowledge item that it creates is a draft, and an approved item that it changes returns to draft, so the Reply Agent never uses text that the user has not approved in the interface.
- Every write needs the user's confirmation. The assistant first shows the user exactly what it will save and waits for a yes. In addition, every call to a write tool requires approval in the agent runtime (Anvia tool approval), which pauses the run until the user decides, so the model cannot write by itself. `connectMcp` takes the list of such tools.
- The audit log records a write with the ids that the call names and the id that it saved. It never stores a rule name or a knowledge text.
- The table `knowledge_proposals` and its enum are dropped by migration `0006_drop_knowledge_proposals`.

## Consequences

- The user can set up a rule and its knowledge entirely in chat, and the same data is editable in the web application.
- A write from the assistant takes effect when the user confirms it, so a mistaken confirmation changes real data. The change is visible in the interface, and an approved item still needs a second approval after it changes.
- A rule that the assistant creates is on by default, like one made in the form, so confirmation of its details matters.
- Changes made through the MCP server by other clients with the `assistant` role are held to the same rules.
- Everything in 0006, 0008 and 0031 that this decision does not change remains in force: two separate agents, the MCP server in the API, user-bound session tokens, scopes, the audit log and the step limits.
