# 0036. Playbooks are enabled or disabled

- Status: Accepted
- Date: 2026-11-22
- Affects: packages/db, packages/knowledge, packages/auto-reply, packages/mcp-server, packages/assistant-agent, apps/api, apps/worker, apps/platform, prompts/assistant.md, docs/overview/README.md

## Context

[0035](0035-playbooks.md) keeps the approval workflow of [0020](0020-knowledge-items-and-approval.md) for playbooks: a playbook is a draft, approved or archived, and only the user approves. In use the second step adds nothing. A playbook that the user writes in the web interface is already the user's own decision, and a playbook that the assistant writes is already confirmed by the user in the chat, because every write tool needs the user's confirmation in the agent runtime ([0032](0032-assistant-writes-with-confirmation.md)).

## Decision

- Replace `approval_status` and `approved_at` on `playbooks` with `enabled`, a boolean that defaults to true. The `approval_status` enum is dropped.
- A playbook is usable at `now` only when it is enabled and `now` is inside its period. `isKnowledgeUsable` in `@leren/knowledge` stays the single definition. Indexing indexes a playbook that is enabled and whose period has not ended.
- `enabled` is part of the body that creates or replaces a playbook. `PATCH /api/playbooks/:id` with `{ "enabled": boolean }` turns a playbook on or off without changing anything else. The approve, archive and restore routes are removed.
- Editing a playbook does not change `enabled`. The assistant's `create_playbook` and `update_playbook` accept `enabled`, and a playbook that it creates is enabled unless the user asks otherwise. The MCP tool `list_playbooks` filters by `enabled` and not by status.
- The interface shows one status for each playbook: `disabled`, or for an enabled playbook its period status `scheduled`, `active` or `expired`.
- Migration `0011_playbooks_enabled` sets `enabled` to true for approved playbooks and to false for drafts and archived playbooks, so no playbook becomes usable that was not usable before.

## Consequences

- A change by the user or by a confirmed assistant write takes effect at once. The only checkpoint before the Reply Agent uses new text is the user's own confirmation.
- The roadmap item about enforcing write confirmation in code matters more, because text that a model writes without a real confirmation is now used immediately.
- 0035 is superseded by this decision. What it says about the merged table, the period, the conditions table, retrieval and the interface tabs stands and is not repeated here.
- The MCP tools no longer return `approvalStatus`, and a filter by status is replaced by a filter by `enabled`.
