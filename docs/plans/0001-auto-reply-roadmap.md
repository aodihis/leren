# 0001. Auto-reply roadmap

Build order for the AI email assistant described in the [high-level design](../overview/README.md). The product requirements are in the PRD "I'm on Vacation", generalised so that a vacation is just an auto-reply rule with a date window.

Legend: `[ ]` todo, `[~]` in progress, `[x]` done. Each feature has a status line. When a feature is merged, tick its chunks, set it to `Done` with the PR link and update the table at the end.

## Delivery workflow

Every feature follows these steps, in order.

1. Create a branch from an up-to-date `main`, named `feat/<NN>-<name>` (`docs/<NN>-<name>` for documentation only).
2. Develop one chunk at a time, in the listed order. Read the matching file in `docs/rules/` and the relevant decisions first. Add an ADR for any structural choice.
3. Test. Add unit and integration tests for the feature. Run `pnpm lint`, `pnpm format:check` and the typecheck of every package touched. Run `pnpm test:lint-rules` when `tooling/oxlint/` changes.
4. Commit in the format from `docs/rules/general.md`, one commit per chunk or logical group.
5. Open a pull request to `main`. List the chunks done and the test evidence.
6. Merge through the pull request only. Never commit to `main` directly. Never push without being asked.
7. After the merge, tick the chunks and mark the feature `Done` with its PR link.

## Features

### F00 HLD and roadmap

Status: In review. Branch: `docs/00-hld-roadmap`.

- [x] Rewrite `docs/overview/README.md` as the high-level design.
- [x] Add this roadmap and the `plans/` row in `docs/README.md`.
- [x] ADRs 0005 (RabbitMQ), 0006 (two agents, UI first), 0007 (derived auto-reply status), 0008 (MCP server in the API, with sessions and scopes).

### F01 Test foundation

Status: Todo. Branch: `feat/01-test-foundation`.

- [~] Add Vitest at the root and in each package. The root setup is done (ADR 0009).
- [ ] Add a PostgreSQL test database helper.
- [ ] Add an in-memory `VectorStore` for tests.
- [ ] Add `pnpm test` and a `pnpm check` script that chains lint, format check, typecheck and test.

### F02 Anvia foundation

Status: Todo. Branch: `feat/02-anvia-foundation`. Blocked until the Anvia SDK and docs are available.

- [ ] Add the Anvia SDK and an ADR for the integration.
- [ ] In `packages/agents`: an agent factory, an MCP client wrapper, a fake LLM for tests and role-scoped tool configuration.
- [ ] In `packages/observability`: a Lens tracer, a no-op tracer and a redaction function.

### F03 RabbitMQ queue

Status: Todo. Branch: `feat/03-rabbitmq-queue`.

- [ ] Add RabbitMQ to `docker-compose.yml` and `.env.example`.
- [ ] Add `packages/queue` with publish, consume, retry with backoff, dead-letter queues and an idempotency helper.
- [ ] Rebuild the `apps/worker` consumers on it, keeping `defineJob`.
- [ ] Update the "Current limitations" section of the overview.
- [ ] Test against a real broker and against a fake.

### F04 Authentication and user isolation

Status: Todo. Branch: `feat/04-auth`.

- [ ] Extend `users` and add sessions.
- [ ] Add the API `auth` module and middleware that sets `userId`.
- [ ] Add the platform login page and an authenticated layout.
- [ ] Test that user A cannot read user B's data.

### F05 Auto-reply rules

Status: Todo. Branch: `feat/05-auto-reply-rules`.

- [ ] Add the `auto_reply_rules` table: user, name, enabled, `starts_at`, `ends_at`, timezone, preferences. No status column.
- [ ] Add a pure `getAutoReplyStatus(rule, now)` with tests for timezones and open bounds.
- [ ] Add the API module and the platform form and list, which show the derived status.

### F06 Knowledge management

Status: Todo. Branch: `feat/06-knowledge`.

- [ ] Add `knowledge_items` (topic, questions, answer, contacts, restrictions, validity, approval `draft|approved|archived`) and `contacts`.
- [ ] Add the API modules.
- [ ] Add the platform screens to create, edit, approve and archive.
- [ ] Test that only approved and currently valid items are usable.

### F07 Indexing pipeline

Status: Todo. Branch: `feat/07-indexing`.

- [ ] Add an `Embedder` interface, an ADR for the provider and a deterministic fake.
- [ ] Index approved knowledge in Qdrant with knowledge id, user id, rule id, type and validity in the payload.
- [ ] Add a `knowledge.index` consumer for create, edit, archive and expiry.
- [ ] Add a drift check between PostgreSQL and Qdrant.
- [ ] Test that every vector references an existing PostgreSQL row.

### F08 Retrieval

Status: Todo. Branch: `feat/08-retrieval`.

- [ ] Add `searchKnowledge` with mandatory filters: user, rule, approved, valid now.
- [ ] Return the top 5 above a score threshold, or an explicit "no reliable result".
- [ ] Test cross-user leakage and exclusion of expired and unapproved items.
- [ ] Add a Recall@5 harness stub.

### F09 MCP server and sessions

Status: Todo. Branch: `feat/09-mcp-server`.

- [ ] Add `packages/mcp-server`, mounted by `apps/api`.
- [ ] Mint user-bound session tokens with scopes, expiry and revocation. Write an audit log.
- [ ] Add scope-gated tools, resources and prompts with agent-neutral names.
- [ ] Integration tests for every tool: valid input, invalid input, missing scope, another user's token, expired and replayed tokens.

### F10 Assistant Agent

Status: Todo. Branch: `feat/10-assistant-agent`.

- [ ] Add the Anvia agent with read tools, `suggest_questions` and `propose_knowledge_edit`.
- [ ] Add the chat panel to the knowledge and rules screens, with accept actions that use the normal API.
- [ ] Confirm the UI works fully without the assistant.
- [ ] Document upload and extraction (PDF, TXT, DOCX, up to 20 files), in a follow-up pull request if large.

### F11 Routing rules

Status: Todo. Branch: `feat/11-routing-rules`.

- [ ] Add the schema: conditions, action `answer|delegate|ignore|escalate`, priority, validity, designated contact. Automatic sending is not available.
- [ ] Add a deterministic evaluator with unit tests.
- [ ] Add the API module, the editor and templates for the five PRD example rules.

### F12 Email ingestion and gate

Status: Todo. Branch: `feat/12-email-gate`.

- [ ] Add an `EmailProvider` interface, a simulated inbox and an endpoint that injects test emails.
- [ ] Add `messages`, `threads`, `decisions` and `drafts`, with a unique idempotency key.
- [ ] Add the listener that publishes `email.received`.
- [ ] Add the gate: deduplicate, check active rules with `getAutoReplyStatus`, then publish `email.process` or record "not applicable".

### F13 Reply Agent and pipeline

Status: Todo. Branch: `feat/13-reply-agent`.

- [ ] Add the Anvia agent with the reply tool set, a 5-step limit and untrusted-input handling.
- [ ] Validate output against a schema, with citations of knowledge ids.
- [ ] Abstain when retrieval finds nothing reliable.
- [ ] Add the pipeline runner consumer on `email.process`.
- [ ] Test with a scripted fake LLM: step limit, abstention and prompt injection.

### F14 Approval and sending

Status: Todo. Branch: `feat/14-approval-send`.

- [ ] Add the API for pending drafts: approve, edit and approve, reject with a reason.
- [ ] Add the `email.send` consumer with retry, delivery status, failure notification and idempotency.
- [ ] Add the approval inbox UI and escalation notifications.

### F15 Dashboard and report

Status: Todo. Branch: `feat/15-dashboard`.

- [ ] Add the overview, counts by outcome, the communication log with filters and failures.
- [ ] Add a summary report for a rule whose window has ended, computed when it is read.

### F16 Evaluation suite

Status: Todo. Branch: `feat/16-evals`.

- [ ] Create 50 cases: 15 project questions, 10 task assignments, 8 informational, 7 urgent, 5 without knowledge, 5 prompt injections.
- [ ] Add the runner and scorers: classification accuracy, Recall@5, groundedness, rule compliance, correct abstention and policy checks.
- [ ] Link results to Lens traces.
- [ ] Add a script that turns failures and rejected drafts into new cases.

### F17 Hardening and documentation

Status: Todo. Branch: `feat/17-hardening-docs`.

- [ ] Add one test per row of the PRD risk table.
- [ ] Write the user-facing docs in `docs/overview/` and the product decisions in `docs/product/`.
- [ ] Add a demo script for the success criteria.

## Order

F00 → F01 → F02 → F03 → F04 → F05 → F06 → F07 → F08 → F09 → F10 → F11 → F12 → F13 → F14 → F15 → F16 → F17.

F11 can run in parallel with F10. F02 and F03 can swap if Anvia access is delayed.

## Status

| Feature | Name                         | Status    | PR  |
| ------- | ---------------------------- | --------- | --- |
| F00     | HLD and roadmap              | In review |     |
| F01     | Test foundation              | Todo      |     |
| F02     | Anvia foundation             | Todo      |     |
| F03     | RabbitMQ queue               | Todo      |     |
| F04     | Authentication and isolation | Todo      |     |
| F05     | Auto-reply rules             | Todo      |     |
| F06     | Knowledge management         | Todo      |     |
| F07     | Indexing pipeline            | Todo      |     |
| F08     | Retrieval                    | Todo      |     |
| F09     | MCP server and sessions      | Todo      |     |
| F10     | Assistant Agent              | Todo      |     |
| F11     | Routing rules                | Todo      |     |
| F12     | Email ingestion and gate     | Todo      |     |
| F13     | Reply Agent and pipeline     | Todo      |     |
| F14     | Approval and sending         | Todo      |     |
| F15     | Dashboard and report         | Todo      |     |
| F16     | Evaluation suite             | Todo      |     |
| F17     | Hardening and documentation  | Todo      |     |

## Changes from the PRD

- The vacation schedule, the `vacation://` resources and the "vacation ends" trigger are replaced by auto-reply rules with a derived status.
- The `send_reply` MCP tool is removed from the agent tool sets. Sending is done by the reply sender after human approval. `request_approval` stays.
- Messages are queued through RabbitMQ, and whether to handle an email is decided by code, not by the agent.
