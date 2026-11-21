# 0035. Playbooks combine rules and knowledge

- Status: Accepted
- Date: 2026-11-21
- Affects: packages/db, packages/auto-reply, packages/knowledge, packages/mcp-server, packages/assistant-agent, apps/api, apps/worker, apps/platform, docs/rules, docs/overview/README.md, docs/plans/0001-auto-reply-roadmap.md

## Context

[0020](0020-knowledge-items-and-approval.md) gives every knowledge item to exactly one auto-reply rule, and [0033](0033-reply-conditions-table.md) stores the conditions of a rule. In use, a rule never has more than one useful item, and a user who writes knowledge also has to write the period of its validity and the people to contact, which repeat what the rule already says. Two screens, two tables and a foreign key describe one thing: when the assistant replies and what it says.

## Decision

- Combine `auto_reply_rules` and `knowledge_items` into one table, `playbooks`. A playbook says when the assistant replies and what it says. It holds `topic`, `examples`, `response`, `restrictions`, `contacts`, `startsAt`, `endsAt`, `timezone`, `approvalStatus` and `approvedAt`, and it belongs to a user.
- The two period pairs become one. `startsAt` and `endsAt` are instants, a null bound is open and both bounds are inclusive. `timezone` only controls how the bounds are entered and shown.
- The rule `name` and the `enabled` flag are removed. `topic` is the label of a playbook. A playbook that must not be used is archived, and archiving replaces disabling.
- `reply_conditions` stays a child table with one row for each channel (decision 0033), and its `rule_id` column becomes `playbook_id`. This is the only one-to-many relationship that remains.
- Approval is unchanged from 0020. The status changes only through the approve, archive and restore actions, a new playbook is a draft, and editing an approved playbook returns it to draft, because the approved text, period and conditions are what the user reviewed.
- A playbook is usable at `now` only when it is approved and `now` is inside its period. `isKnowledgeUsable` in `@leren/knowledge` stays the single definition. The derived period status `scheduled`, `active` or `expired` (decision 0007) is computed from `startsAt`, `endsAt` and `now` and is never stored. `getAutoReplyStatus` in `@leren/auto-reply` computes it and no longer has a `disabled` value.
- Retrieval (decision 0028) searches the playbooks of a user and is no longer scoped by a rule. A caller that must respect the reply conditions evaluates them with `evaluateEmailConditions` on the playbooks that retrieval returns.
- The API replaces `/api/auto-reply-rules` and `/api/knowledge-items` with `/api/playbooks`. The approval routes are `POST /api/playbooks/:id/:action`. The MCP read tools are `list_playbooks`, `get_playbook` and `search_playbooks`, and the write tools are `create_playbook` and `update_playbook`. The scopes `rules:read` and `knowledge:read` become `playbooks:read`.
- The platform has one Playbooks page. Opening a playbook shows the tabs Knowledge, with the topic, response, examples, restrictions and contacts, and Rules, with the period and the reply conditions.
- The migration `0010_playbooks` creates `playbooks`, moves each knowledge item with the period of its rule, and then drops the old tables. A knowledge item takes `startsAt` and `endsAt` from its own `valid_from` and `valid_until` when it has them, and from its rule otherwise. A rule without any knowledge item becomes a draft playbook with the rule name as its topic and an empty response.

## Consequences

- A rule can no longer be reused by several knowledge items. A user who wants the same conditions for two topics creates two playbooks.
- 0020 and 0033 are superseded by this decision. What they say about approval, usability, contacts and the conditions table stands as restated here.
- The rule API, the knowledge API, the MCP tools and their scopes break. Tokens that hold an old scope must be minted again.
- Indexing indexes a playbook that is approved and whose period has not ended. The vector payload no longer carries a rule.
- A reply that depends on conditions needs one extra step after retrieval, because the index cannot filter by conditions.
