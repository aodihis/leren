# 0049. Playbooks have no contacts field and the pipeline has no delegate outcome

- Status: Accepted
- Date: 2026-11-24
- Affects: packages/db, packages/reply-agent, packages/mcp-server, packages/assistant-agent, apps/api, apps/worker, apps/platform, docs/overview/README.md

## Context

[0035](0035-playbooks.md) gave each playbook a `contacts` list, and [0042](0042-reply-agent-pipeline.md) let the routing model choose `delegate` and copy a contact from it into a fixed reply. A contact is only text that a reply may repeat. The drafter already reads the `response` of a playbook and may repeat any detail of it, including an address or a phone number, so the field duplicated what `response` can say. It also made the routing ambiguous: an email that a playbook could answer was sometimes delegated only because the playbook named a contact, and the sender then got a name instead of the answer.

## Decision

- A playbook has no `contacts` field. A user who wants a reply to point to a person writes that in the `response`.
- The pipeline has no `delegate` outcome. The routing model chooses `answer` or `escalate`. It chooses `answer` when a playbook covers at least one question of the email, and the drafter then answers only the questions that a playbook covers and says that the sender will get an answer to the others later.
- The migration appends the existing contacts of each playbook to its `response`, as a final line that starts with `Contact:`, and then drops the column. It also changes the stored outcome `delegate` to `answer`. The playbooks that changed have to be indexed again, because the migration does not publish to `knowledge.index`.
- The database enum `reply_outcome` has the values `answer`, `escalate` and `ignore`. The migration recreates it without `delegate`, after it has changed the stored `delegate` outcomes to `answer`. A playbook whose response would pass 5000 characters with its contacts appended keeps its response, and its contacts are dropped.

## Consequences

- One place, the response, says what a reply may tell the sender, and the judge checks a reply against it.
- The API, the MCP tools, the assistant tools and the playbook form lose the field, and the assistant keeps a person to contact in the response.
- The reply for a contact is no longer a fixed text, so it passes the same drafting, evaluation and output guardrails as every other answer.
- The decisions 0035 and 0042 stay as written. Where they describe `contacts` and `delegate`, this decision replaces them.
