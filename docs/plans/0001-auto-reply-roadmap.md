# 0001. Auto-reply roadmap

Build order for the AI email assistant described in the [high-level design](../overview/README.md). The product requirements are in the PRD "I'm on Vacation", generalised so that a vacation is just an auto-reply rule with a date window.

Legend: `[ ]` todo, `[x]` done. A feature is either `Todo` or `Done`. Each feature has a status line. In the same commit that finishes a feature, tick its chunks, set it to `Done` with the PR link and update the table at the end.

## Delivery workflow

Every feature follows these steps, in order.

1. Create a branch from an up-to-date `main`, named `feat/<NN>-<name>` (`docs/<NN>-<name>` for documentation only).
2. Develop one chunk at a time, in the listed order. Read the matching file in `docs/rules/` and the relevant decisions first. Add an ADR for any structural choice.
3. Test. Add unit and integration tests for the feature. Run `pnpm lint`, `pnpm format:check` and the typecheck of every package touched. Run `pnpm test:lint-rules` when `tooling/oxlint/` changes.
4. Commit in the format from `docs/rules/general.md`, one commit per chunk or logical group.
5. Open a pull request to `main`. List the chunks done and the test evidence.
6. Merge through the pull request only. Never commit to `main` directly. Never push without being asked.

## Features

### F00 HLD and roadmap

Status: Done. Branch: `docs/00-hld-roadmap`. PR: [#2](https://github.com/aodihis/leren/pull/2).

- [x] Rewrite `docs/overview/README.md` as the high-level design.
- [x] Add this roadmap and the `plans/` row in `docs/README.md`.
- [x] ADRs 0005 (RabbitMQ), 0006 (two agents, UI first), 0007 (derived auto-reply status), 0008 (MCP server in the API, with sessions and scopes).

### F01 Test foundation

Status: Done. Branch: `feat/01-test-foundation`. PR: [#3](https://github.com/aodihis/leren/pull/3).

- [x] Add Vitest. One root configuration covers every package (ADR 0009).
- [x] Add a PostgreSQL test database helper.
- [x] Add an in-memory `VectorStore` for tests.
- [x] Add `pnpm test` and a `pnpm check` script that chains lint, format check, typecheck and test.

### F02 Anvia foundation

Status: Done. Branch: `feat/02-anvia-foundation`. PRs: [#4](https://github.com/aodihis/leren/pull/4), [#5](https://github.com/aodihis/leren/pull/5).

- [x] Add the Anvia SDK and an ADR for the integration (ADR 0010).
- [x] In `packages/agents`: an agent factory, an MCP client wrapper and a fake LLM for tests. Add `packages/assistant-agent` and `packages/reply-agent` with their role-scoped tool configuration.
- [x] In `packages/observability`: a vendor-neutral observer with a Lens implementation, a no-op observer and a redaction function.

### F03 RabbitMQ queue

Status: Done. Branch: `feat/03-rabbitmq-queue`. PR: [#6](https://github.com/aodihis/leren/pull/6).

- [x] Add RabbitMQ to `docker-compose.dev.yml` and `.env.example`.
- [x] Add `packages/queue` with publish, consume, retry with backoff, dead-letter queues and an idempotency helper.
- [x] Rebuild the `apps/worker` consumers on it, keeping `defineJob`.
- [x] Update the "Current limitations" section of the overview.
- [x] Test against a real broker and against a fake.

### F04 Authentication and user isolation

Status: Done. Branch: `feat/04-auth`. PR: [#7](https://github.com/aodihis/leren/pull/7).

- [x] Extend `users` and add sessions, accounts and verifications.
- [x] Add the API `auth` module and middleware that sets `userId`. Sign-in and registration use an emailed one-time code with Better Auth (ADR 0013).
- [x] Add `packages/email` with an SMTP sender and Mailpit in `docker-compose.dev.yml` (ADR 0014).
- [x] Add the platform login page, profile page and authenticated layout.
- [x] Test that user A cannot read user B's data. Only the profile exists so far. Extend the test when a feature adds user-owned data.

### F05 Auto-reply rules

Status: Done. Branch: `feat/05-auto-reply-rules`. PR: [#10](https://github.com/aodihis/leren/pull/10).

- [x] Add ADR 0019, which supersedes 0007 and splits channel conditions from the rule.
- [x] Add the `auto_reply_rules` table: user, name, enabled, `starts_at`, `ends_at`, timezone. No status column.
- [x] Add the `email_reply_conditions` table: sender, recipient role, sole recipient, mention, thread and bulk mail options.
- [x] Add `@leren/auto-reply` with a pure `getAutoReplyStatus(rule, now)` and email condition evaluation, with tests for timezones, open bounds and each condition.
- [x] Add the API module and the platform form and list, which show the derived status.

### F06 Knowledge management

Status: In progress. Branch: `feat/06-knowledge`.

- [x] Add `knowledge_items` (topic, response, examples, contacts, restrictions, validity, approval `draft|approved|archived`). Contacts are a list of text on the item (ADR 0020).
- [x] Add the API modules.
- [x] Add the platform screens to create, edit, approve and archive.
- [x] Test that only approved and currently valid items are usable.

### F07 Indexing pipeline

Status: In progress. Branch: `feat/07-indexing`.

- [x] Add an `Embedder` interface, an ADR for the provider (ADR 0024) and a deterministic fake.
- [x] Index approved knowledge in Qdrant with knowledge id, user id, rule id, type and validity in the payload.
- [x] Add a `knowledge.index` consumer for create, edit, archive and expiry.
- [x] Add a drift check between PostgreSQL and Qdrant.
- [x] Test that every vector references an existing PostgreSQL row.

### F08 Retrieval

Status: In progress. Branch: `feat/08-retrieval`.

- [x] Add `searchKnowledge` with mandatory filters: user, rule, approved, valid now (ADR 0028).
- [x] Return the top 5 above a score threshold, or an explicit "no reliable result".
- [x] Test cross-user leakage and exclusion of expired and unapproved items.
- [x] Add a Recall@5 harness stub.
- [x] Add integration tests against real Qdrant. They also run against the embedding endpoint when `EMBEDDING_API_KEY` is set.
- [ ] Run the embedding endpoint tests with a working key and tune `DEFAULT_MIN_SCORE`.

### F09 MCP server and sessions

Status: In progress. Branch: `feat/09-mcp-server`.

- [x] Add `packages/mcp-server`, mounted by `apps/api` (ADR 0031).
- [x] Mint user-bound session tokens with scopes, expiry and revocation. Write an audit log.
- [x] Add scope-gated tools, resources and prompts with agent-neutral names.
- [x] Integration tests for every tool: valid input, invalid input, missing scope, another user's token, expired and replayed tokens.

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

### F12a Channel accounts

Status: Todo. Branch: `feat/12a-channel-accounts`.

- [ ] Add an ADR for the first OAuth provider, its scopes and the token encryption key.
- [ ] Add the `channel_accounts` table and a nullable `channel_account_id` on `email_reply_conditions` (ADR 0021).
- [ ] Add the API routes that start and finish the OAuth connection, with a state value and PKCE, and refresh and revoke tokens. Allow one email account for each user.
- [ ] Add the platform screen to connect and disconnect the account, and let a rule choose it.
- [ ] Test that user A cannot see or use user B's account, and that one provider account cannot belong to two users.

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

- [ ] Reply Agent suite in `packages/reply-agent/src/evals`: 50 cases: 15 project questions, 10 task assignments, 8 informational, 7 urgent, 5 without knowledge, 5 prompt injections.
- [ ] Assistant Agent suite in `packages/assistant-agent/src/evals`: cases for lookups of saved data, suggested questions, edit proposals that match the source, and requests to approve or send, which must be refused. Score tool choice, faithfulness to saved data and proposal-only behavior.
- [ ] Add a shared runner and the Reply Agent scorers: classification accuracy, Recall@5, groundedness, rule compliance, correct abstention and policy checks. Each suite has its own dataset and quality gate.
- [ ] Link results to Lens traces.
- [ ] Add a script that turns failures and rejected drafts into new cases.

### F17 Hardening and documentation

Status: Todo. Branch: `feat/17-hardening-docs`.

- [ ] Add one test per row of the PRD risk table.
- [ ] Write the user-facing docs in `docs/overview/` and the product decisions in `docs/product/`.
- [ ] Add a demo script for the success criteria.

## Order

F00 → F01 → F02 → F03 → F04 → F05 → F06 → F07 → F08 → F09 → F10 → F11 → F12a → F12 → F13 → F14 → F15 → F16 → F17.

F11 can run in parallel with F10. F02 and F03 can swap if Anvia access is delayed.

## Status

| Feature | Name                         | Status      | PR                                                                                           |
| ------- | ---------------------------- | ----------- | -------------------------------------------------------------------------------------------- |
| F00     | HLD and roadmap              | Done        | [#2](https://github.com/aodihis/leren/pull/2)                                                |
| F01     | Test foundation              | Done        | [#3](https://github.com/aodihis/leren/pull/3)                                                |
| F02     | Anvia foundation             | Done        | [#4](https://github.com/aodihis/leren/pull/4), [#5](https://github.com/aodihis/leren/pull/5) |
| F03     | RabbitMQ queue               | Done        | [#6](https://github.com/aodihis/leren/pull/6)                                                |
| F04     | Authentication and isolation | Done        | [#7](https://github.com/aodihis/leren/pull/7)                                                |
| F05     | Auto-reply rules             | Done        | [#10](https://github.com/aodihis/leren/pull/10)                                              |
| F06     | Knowledge management         | Todo        |                                                                                              |
| F07     | Indexing pipeline            | Todo        |                                                                                              |
| F08     | Retrieval                    | In progress |                                                                                              |
| F09     | MCP server and sessions      | In progress |                                                                                              |
| F10     | Assistant Agent              | Todo        |                                                                                              |
| F11     | Routing rules                | Todo        |                                                                                              |
| F12a    | Channel accounts             | Todo        |                                                                                              |
| F12     | Email ingestion and gate     | Todo        |                                                                                              |
| F13     | Reply Agent and pipeline     | Todo        |                                                                                              |
| F14     | Approval and sending         | Todo        |                                                                                              |
| F15     | Dashboard and report         | Todo        |                                                                                              |
| F16     | Evaluation suite             | Todo        |                                                                                              |
| F17     | Hardening and documentation  | Todo        |                                                                                              |

## Changes from the PRD

- The vacation schedule, the `vacation://` resources and the "vacation ends" trigger are replaced by auto-reply rules with a derived status.
- The `send_reply` MCP tool is removed from the agent tool sets. Sending is done by the reply sender after human approval. `request_approval` stays.
- Messages are queued through RabbitMQ, and whether to handle an email is decided by code, not by the agent.
