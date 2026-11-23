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
- [x] Add the reply conditions table (now `reply_conditions` with a channel, ADR 0033) with the email settings: sender, recipient role, sole recipient, mention, thread and bulk mail options.
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
- [x] Run the embedding endpoint tests with a working key and tune `DEFAULT_MIN_SCORE`.

### F09 MCP server and sessions

Status: In progress. Branch: `feat/09-mcp-server`.

- [x] Add `packages/mcp-server`, mounted by `apps/api` (ADR 0031).
- [x] Mint user-bound session tokens with scopes, expiry and revocation. Write an audit log.
- [x] Add scope-gated tools, resources and prompts with agent-neutral names.
- [x] Integration tests for every tool: valid input, invalid input, missing scope, another user's token, expired and replayed tokens.

### F10 Assistant Agent

Status: Todo. Branch: `feat/10-assistant-agent`.

- [x] Add the Anvia agent with read tools and confirmed write tools for rules and knowledge (ADR 0032).
- [x] Add the `structure-knowledge` skill and the assistant prompt, tried in Anvia Studio (`pnpm studio:assistant`).
- [x] Add the full-page chat, with New chat and the history in the sidebar, over Anvia's client protocol and memory (ADR 0034). The assistant confirms writes in the chat.
- [x] Confirm the UI works fully without the assistant. The rules and knowledge screens do not call the assistant API.
- [ ] Revisit write confirmation. The assistant confirms in the chat by following its prompt (ADR 0034), so a model that ignores the prompt, or text stored in a rule or knowledge item, could trigger a write without a yes. Decide whether to enforce confirmation in code, for example a runtime approval on the write tools or a write that takes effect only after the user clicks in the interface. Deferred: not part of F10.
- [ ] Document upload and extraction (PDF, TXT, DOCX, up to 20 files). Deferred: not part of F10.

### F11 Routing rules

Status: Dropped. Playbooks cover it (ADR 0037).

### F12a Channel accounts

Status: In progress. Branch: `feat/12a-channel-accounts`.

- [x] Add an ADR for the first OAuth provider, its scopes and the token encryption key (ADR 0038).
- [x] Add the `channel_accounts` table and a nullable `channel_account_id` on `reply_conditions` (ADRs 0021, 0033 and 0038).
- [x] Add the API routes that start and finish the OAuth connection, with a state value and PKCE, and refresh and revoke tokens. Allow one email account for each user.
- [x] Add the platform screen to connect and disconnect the account, and let a playbook choose it.
- [x] Test that user A cannot see or use user B's account, and that one provider account cannot belong to two users.
- [x] Connect a real Google account once by hand, with the project in testing mode and a test user.

### F12 Email ingestion and gate

Status: Done. Branch: `feat/12-email-gate`.

- [x] Add the `messages` table that records each received email with its provider ids, channel, truncated body and status, and the `@leren/inbox` package that records a message, publishes `email.received` and moves the status forward (ADR 0039). It replaces the planned `messages`, `threads`, `decisions` and `drafts`: a thread is the provider's thread id, and decisions and drafts belong to F13 and F14.
- [x] Add the reply mode `draft` or `send` to the email conditions of a playbook, with a control on the Rules tab. The assistant cannot set it.
- [x] Add the gate: consume `email.received`, check the usable playbooks of the account with `isKnowledgeUsable` and `evaluateEmailConditions`, then set `queued` and publish `email.process`, or set `not_applicable` with a reason.
- [x] Add `GET /api/messages` and `GET /api/messages/:id` for the dashboard, and `POST /api/messages/simulate` to inject a test email while the `mailpit` provider is enabled.

### F12b Email listener

Status: In progress. Branch: `feat/12b-email-listener`.

- [x] Decide the listener: poll Gmail from the worker, ingest only new mail, and move the provider and token code into `@leren/channels` (ADR 0040, superseded by ADR 0041).
- [x] Move the channel provider, encryption and token code out of `apps/api` into `@leren/channels`, add it to `docs/rules/packages.md`, and add `sync_cursor` to `channel_accounts`. Connecting an account sets the cursor to the position of the mailbox at that moment (ADR 0041).
- [x] Add the `EmailProvider` interface, the Gmail `fetchNewMail`, and the `email.poll` timer and job that record new mail. Write the cursor only if it is unchanged since it was read, skip a message that Gmail reports as not found, and read every page of the history.
- [ ] Later: add Gmail push notifications in front of the same `email.poll` job, to cut the delay from up to a minute to a few seconds. It needs its own decision. It adds a Pub/Sub topic, a public HTTPS endpoint that verifies the OIDC token of each push, a renewal of `users.watch` at least every 7 days, and a fallback poll.

### F13 Reply Agent and pipeline

Status: In progress. Branch: `feat/13-reply-agent`.

- [x] Decide the pipeline: fixed stages with an evaluator-optimizer loop and guardrails (ADR 0042).
- [x] Build the pipeline with `@anvia/core/pipeline` in `packages/reply-agent`: input guardrail, triage, retrieve through an injected `retrieve` function, route, draft, evaluate and revise, output guardrail. The caller persists the result.
- [x] Make the Anvia agent return structured output with citations of knowledge ids, a 5-step limit and untrusted-input handling. It has no write tool.
- [x] Abstain, without calling the agent, when retrieval finds nothing reliable.
- [x] Add the evaluator: deterministic checks and a judge model that compares the draft with the retrieved playbooks and the reply instructions. Allow 2 revisions, then escalate.
- [x] Add `REPLY_JUDGE_MODEL` and `REPLY_TRIAGE_MODEL` to the harness config and `.env.example`.
- [x] Save the decision and the draft in `reply_decisions`, add the status `escalated`, and set `processing`, `drafted`, `escalated`, `not_applicable` and `failed` through `transitionMessage` as the pipeline passes each stage (ADR 0043). F14 sets the statuses of approval and sending.
- [x] Add the `email.process` consumer: it uses only the playbooks of the gate, makes the mention check when every playbook asks for it, is safe to deliver again, and marks the message failed when its last attempt fails.
- [x] Test with a scripted fake LLM: step limit, abstention, prompt injection, the revision limit and failing closed.
- [x] Add the first evals of the pipeline: outcome (routing and abstention), content, citations and judge calibration, in `packages/reply-agent/src/evals`. They need live models, so they are not run in CI. Triage accuracy and Recall@5 are left for F16, and Recall@5 needs the real index.
- [x] Add the MCP-backed `retrieve` function (`createMcpRetriever`), search once for each question of the email, merge the playbooks and judge coverage of every question.
- [x] Open the MCP session of a run in the worker (`openReplySession`): short-lived, bound to the owner of the message and to the message id, read-only, and revoked when the run ends.
- [x] Add `MCP_SESSION_SECRET` and `MCP_URL` to the worker config. The worker does not consume `email.process` when the secret, the models or the prompt are not available.
- [x] Create one observer in the worker, pass it to the pipeline, flush it after each message and close it in the worker's `shutdown`, so that the last batch of telemetry is delivered.
- [ ] Later: reply instructions written by the user (needs a product decision) and reply templates.
- [x] Require a channel account for an enabled playbook (ADR 0044): validate in the API schema and service, let the assistant tools take the account and default to the only one, update the assistant prompt, mark playbooks without a mailbox in the list, and add assistant eval cases. Found when a playbook created in the chat never handled an email, because the chat tool could not name a mailbox.

### F14 Reply delivery

Status: In progress. Branch: `feat/14-approval-send`. Decisions: 0045 and 0046, and product decision 0002.

- [x] Add worker roles (`WORKER_ROLES`: `listener`, `processor`, `indexer`) so that reading mail, processing and indexing can run in separate processes (ADR 0045).
- [x] Add the delivery record to the decision (state, the stored request and response, attempts, times, ids and error), and let `drafted` move to `sent` and `failed` (ADR 0046).
- [x] Choose the mode when the pipeline ends: deliver as a mailbox draft, or send at once only when every playbook that the decision used is in `send` mode (product decision 0002).
- [x] Add `createDraft` and `sendReply` to the Gmail provider, and the `gmail.compose` scope.
- [x] Add the `email.deliver` consumer: it writes the record before the call, never repeats a delivery that started, applies the loop and bulk-mail guards, and stores the ids and errors.
- [x] Return the outcome and the delivery state with `GET /api/messages`, and the whole decision with `GET /api/messages/:id`.
- [x] Add the Processed emails page to the platform: the list with the status filter, and the detail with the email, the reply, the cited playbooks and the delivery record.
- [x] Capture the payloads in the telemetry (ADR 0047).
- [ ] Later: email notifications for an escalation or a failed delivery, and a limit on sends for each hour.

### F15 Dashboard and report

Status: In progress. Branch: `feat/15-dashboard`. Decision: 0048.

- [x] Add the overview, counts by outcome, the communication log with filters and failures.
- [x] Add a summary report for a rule whose window has ended, computed when it is read.

### F16 Evaluation suite

Status: In progress. Branch: `feat/16-evals`.

- [x] Reply Agent suite in `packages/reply-agent/src/evals`: 50 cases: 15 project questions, 10 task assignments, 8 informational, 7 urgent, 5 without knowledge, 5 prompt injections.
- [ ] Assistant Agent suite in `packages/assistant-agent/src/evals`: cases for lookups of saved data, suggested questions, edit proposals that match the source, and requests to approve or send, which must be refused. Score tool choice, faithfulness to saved data and proposal-only behavior.
- [ ] Add a shared runner and the Reply Agent scorers: classification accuracy, Recall@5, groundedness, rule compliance, correct abstention and policy checks. Each suite has its own dataset and quality gate. Done for the Reply suite: classification, abstention, groundedness, policy and a per-metric gate (`gate.ts`). Left: Recall@5, a shared runner for the Assistant suite, and a dedicated rule-compliance scorer.
- [ ] Link results to Lens traces.
- [ ] Add a script that turns failures and rejected drafts into new cases.

- [x] Remove the playbook `contacts` field and the `delegate` outcome (ADR 0049). The router answers when a playbook covers at least one question, and a person to contact is written in the response.

### F17 Hardening and documentation

Status: Todo. Branch: `feat/17-hardening-docs`.

- [ ] Add one test per row of the PRD risk table.
- [ ] Write the user-facing docs in `docs/overview/` and the product decisions in `docs/product/`.
- [ ] Add a demo script for the success criteria.

## Order

F00 → F01 → F02 → F03 → F04 → F05 → F06 → F07 → F08 → F09 → F10 → F12a → F12 → F12b → F13 → F14 → F15 → F16 → F17.

F02 and F03 can swap if Anvia access is delayed.

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
| F11     | Routing rules                | Dropped     |                                                                                              |
| F12a    | Channel accounts             | In progress | [#29](https://github.com/aodihis/leren/pull/29)                                              |
| F12     | Email ingestion and gate     | Done        | [#30](https://github.com/aodihis/leren/pull/30)                                              |
| F12b    | Email listener               | In progress |                                                                                              |
| F13     | Reply Agent and pipeline     | Todo        |                                                                                              |
| F14     | Approval and sending         | Todo        |                                                                                              |
| F15     | Dashboard and report         | In progress |                                                                                              |
| F16     | Evaluation suite             | Todo        |                                                                                              |
| F17     | Hardening and documentation  | Todo        |                                                                                              |

## Changes from the PRD

- The vacation schedule, the `vacation://` resources and the "vacation ends" trigger are replaced by auto-reply rules with a derived status.
- Auto-reply rules and knowledge items are combined into playbooks (ADR 0035). Chunks that name a rule or a knowledge item now mean a playbook.
- The `send_reply` MCP tool is removed from the agent tool sets. Sending is done by the reply sender, after human approval or at once when the playbook is in `send` mode (product decision 0001). `request_approval` stays.
- Messages are queued through RabbitMQ, and whether to handle an email is decided by code, not by the agent.
