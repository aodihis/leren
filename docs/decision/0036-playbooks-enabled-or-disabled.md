# 0036. Playbooks are enabled or disabled

- Status: Accepted
- Date: 2026-11-22
- Affects: docs/decision/0034-assistant-chat-over-anvia-protocol.md, packages/db, packages/knowledge, packages/auto-reply, packages/mcp-server, packages/assistant-agent, apps/api, apps/worker, apps/platform, prompts/assistant.md, docs/overview/README.md

## Context

[0035](0035-playbooks.md) keeps the approval workflow of [0020](0020-knowledge-items-and-approval.md) for playbooks: a playbook is a draft, approved or archived, and only the user approves. A playbook that the user writes in the web interface is already the user's own decision, so for those the second step adds nothing.

A playbook that the assistant writes is different. [0034](0034-assistant-chat-over-anvia-protocol.md) removed the runtime pause on write tools, so the assistant's confirmation is only a rule in its prompt, and approval was the one step that code enforced before the Reply Agent used text that the assistant wrote. The owner of the product chose to remove approval anyway, to keep one simple switch.

## Decision

- Replace `approval_status` and `approved_at` on `playbooks` with `enabled`, a boolean that defaults to true. The `approval_status` enum is dropped.
- A playbook is usable at `now` only when it is enabled and `now` is inside its period. `isKnowledgeUsable` in `@leren/knowledge` stays the single definition. Indexing indexes a playbook that is enabled and whose period has not ended.
- `enabled` is part of the body that creates or replaces a playbook. `PATCH /api/playbooks/:id` with `{ "enabled": boolean }` turns a playbook on or off without changing anything else. The approve, archive and restore routes are removed.
- Editing a playbook does not change `enabled`. The assistant's `create_playbook` and `update_playbook` accept `enabled`, and a playbook that it creates is enabled unless the user asks otherwise. The MCP tool `list_playbooks` filters by `enabled` and not by status.
- The assistant confirms every write with the user in the conversation before it calls a write tool. That is a rule in the assistant prompt and no code enforces it, as in 0034. The assistant's writes take effect immediately.
- The interface shows one status for each playbook: `disabled`, or for an enabled playbook its period status `scheduled`, `active` or `expired`.
- Migration `0011_playbooks_enabled` sets `enabled` to true for approved playbooks and to false for drafts and archived playbooks, so no playbook becomes usable that was not usable before.

## Consequences

- A change by the user takes effect at once. A change by the assistant also takes effect at once, and the only check before the Reply Agent uses it is the model following its prompt. A model that ignores the prompt, or stored playbook text that steers it, can change what replies say without any click in the interface.
- The roadmap item about enforcing write confirmation in code is now more urgent. The options are a runtime approval on the write tools, which needs a stored suspended run, or assistant writes that leave a playbook disabled until the user turns it on in the list.
- 0035 and 0034 are superseded by this decision. What 0035 says about the merged table, the period, the conditions table, retrieval and the interface tabs stands. What 0034 says about the chat protocol, the conversation memory and confirming writes in the conversation stands. The part of 0034 that keeps knowledge saved as a draft and approved only by the user no longer applies.
- The MCP tools no longer return `approvalStatus`, and a filter by status is replaced by a filter by `enabled`.
