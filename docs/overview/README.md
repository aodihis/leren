# High-level design

Leren is an AI email assistant. The user defines **auto-reply rules**, teaches the system what it needs to know, and says how messages should be handled. While a rule is in effect, incoming work email is classified and then answered from approved knowledge, delegated, ignored or escalated. The first version only creates drafts. A person approves every reply before it is sent.

## Components

| Component  | Role                                                                                                              |
| ---------- | ----------------------------------------------------------------------------------------------------------------- |
| `platform` | The web application: rule and knowledge management, an optional assistant chat, the approval inbox, a dashboard.  |
| `api`      | The only service that reads or writes PostgreSQL and Qdrant. It validates every request and hosts the MCP server. |
| `worker`   | Runs the queue consumers: email listener, gate, pipeline runner and reply sender.                                 |
| RabbitMQ   | Durable queues between the stages, with retries and dead-letter queues.                                           |
| PostgreSQL | The source of truth for users, rules, knowledge, messages, decisions and drafts.                                  |
| Qdrant     | The vector index of approved knowledge, accessed through `@leren/vector-db`.                                      |
| Anvia      | The agent framework for both agents, and Lens for tracing and evaluation.                                         |

## Auto-reply rules and derived status

An auto-reply rule has an `enabled` flag, an optional `starts_at`, an optional `ends_at` and a timezone. Its status is computed from those fields and the current time. It is never stored.

| Status      | Condition                                        |
| ----------- | ------------------------------------------------ |
| `disabled`  | `enabled` is false.                              |
| `scheduled` | `enabled` is true and now is before `starts_at`. |
| `active`    | `enabled` is true and now is inside the window.  |
| `expired`   | `enabled` is true and now is after `ends_at`.    |

A missing bound is open. Knowledge and routing rules belong to an auto-reply rule, so retrieval filters by rule, approval status and validity dates.

A rule has a name that identifies it in the list. It also has conditions for each channel. For email, the conditions say:

- Which senders are answered: anyone, or only listed addresses and domains.
- Which recipient roles are answered: To, Cc or Bcc. A message is Bcc when the user's address is in neither the To nor the Cc header.
- Whether the user must be the only recipient when addressed in the To header.
- Whether a message that mentions the user by name is answered even when the role or the recipient count would otherwise exclude it. Names are matched against the user's name and a list of aliases. A rule can also ask a model to decide when no alias matches.
- Whether new threads, replies in an existing thread, or both are answered.
- Whether mailing lists and automatically generated messages are skipped.

## Knowledge and approval

Knowledge is a set of **knowledge items**. Each belongs to one auto-reply rule and has a topic, a response that the assistant may give, optional example messages that help find the item, restrictions on what must not be said, an optional validity window and optional **contacts**, the email addresses or handles of the people a reply may point to.

An item is a `draft`, `approved` or `archived`. The assistant may use an item only when it is approved and the current time is inside its validity window. Only the user approves, archives or restores an item. Editing an approved item returns it to draft, so a changed text is reviewed again.

## Channels and accounts

A **channel** is a kind of medium that messages arrive on, such as email or Slack. A user connects a **channel account** with OAuth, for example a Gmail mailbox. A message belongs to the user who owns the account it was fetched through. The address the user signs in with is not used to match messages, and it can differ from every connected address.

A user has many rules and a rule has many knowledge items. A rule listens on a channel when it has the conditions for that channel, and those conditions name the channel account to listen on. Channels and channel accounts are specified in decision 0021 and are not built yet.

## Agents

The platform UI is the main way to manage data. The assistant is an optional helper beside it. The two agents never share a prompt, a tool set or a session.

|             | Assistant Agent                                                                    | Reply Agent                                          |
| ----------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Started by  | The user, from the chat panel in the platform.                                     | A queued email job.                                  |
| Purpose     | Look up saved data, generate example questions, refine wording and point out gaps. | Decide how to handle one email and draft the output. |
| Writes      | Proposals only. The user accepts them in the UI.                                   | A draft reply or a decision record. It cannot send.  |
| Input trust | Written by the user.                                                               | Email content is untrusted data, never instructions. |
| Step limit  | One interactive turn at a time.                                                    | At most 5 steps.                                     |

## Flow A: configuration

```
User ─▶ platform UI ─▶ api ─▶ services ─▶ PostgreSQL
                                    └─▶ queue knowledge.index ─▶ worker ─▶ embed ─▶ Qdrant

User ─▶ platform chat ─▶ api ─▶ Assistant Agent
                                   │ MCP (session bound to the user)
                                   ▼
                            MCP server (in api) ─▶ services ─▶ PostgreSQL / Qdrant
```

The UI is the primary path. The assistant reads saved data and proposes edits, and the user accepts a proposal through the same API the UI uses.

## Flow B: incoming email

```
Email provider
   │ poll or webhook
   ▼
Email listener (worker) ─▶ [email.received]
                                │
                                ▼
                       Gate (worker, code only)
                         - drop duplicates by provider message id
                         - find the user's active auto-reply rules
                         - none found: record "not applicable" and stop
                                │
                                ▼
                         [email.process]
                                │
                                ▼
                  Pipeline runner (worker) ─▶ Reply Agent
                                                 │ MCP
                                                 ▼
                                          MCP server (in api) ─▶ PostgreSQL / Qdrant
                                │ decision and draft
                                ▼
                  Approval inbox (platform): approve, edit or reject
                                │ approved
                                ▼
                          [email.send] ─▶ Reply sender (worker) ─▶ Email provider
```

Whether an email is handled at all is decided by the gate, in code, from stored rules and their conditions. The Reply Agent is never asked whether to reply to a message outside an active rule. The only model call in the gate is the optional mention check of a rule that asks for it.

## Queues

The queues are `email.received`, `email.process`, `email.send` and `knowledge.index`, each with a dead-letter queue named `<queue>.dlq`. A failed message is retried with exponential backoff and moved to the dead-letter queue when its attempts are used up. A consumer acknowledges a message only after its work is durable. Every message carries an idempotency key, and every handler is safe to retry.

## Knowledge indexing

Only approved knowledge whose validity window has not ended is searchable. Each such item has one vector in the Qdrant collection `knowledge`, and the vector id is the item id. The text that is embedded is the topic, the response and the examples. The payload holds the item, user and rule ids, the type, the window and the `updatedAt` of the row that the vector was built from.

When the API creates, edits, approves, archives, restores or deletes an item, it publishes the item id to `knowledge.index`. The worker reads the current row and makes the index match it, so a repeated or reordered message does no harm. A periodic `knowledge.drift` job compares PostgreSQL with Qdrant, repairs any difference and removes the vectors of expired items. Embeddings come from an OpenAI-compatible endpoint, which is OpenRouter by default (decision 0024).

## MCP server

The MCP server lives in `api` and exposes tools, resources and prompts. It is the integration surface of the system. It is not private to the two built-in agents, so a user could later connect their own agent instead of using the assistant.

- **Scopes.** Tools are grouped into scopes such as `knowledge:read`, `knowledge:propose`, `rules:read` and `reply:draft`. A session receives only the scopes granted to its client. The Assistant Agent and the Reply Agent are built-in clients with fixed scopes.
- **Neutral tools.** Tool names and schemas do not depend on our prompts or agent framework.
- **Drafts only.** Mutating tools create drafts or proposals. Approval is a separate action by the user in the UI, so no agent can approve its own writes. No agent can send email.

### Sessions and security

- **Token.** The API mints a short-lived signed token when it starts an agent run. The token carries the user id, the client role, the scopes, an expiry and, for the Reply Agent, the id of the message being handled.
- **Binding.** Each MCP session is bound to one user when it is created. The user id is never a tool argument. A request whose token does not match its session is rejected.
- **Isolation.** Every service call made by a tool receives the session's user id and filters by it. Qdrant queries always filter by user id.
- **Per-call checks.** The server checks the scope and the ownership of every referenced id on each call.
- **Mutations.** Mutating tools validate input, accept an idempotency key and write an audit record. The Reply Agent session can only draft for its own message.
- **Lifecycle.** Sessions expire and can be revoked. Tokens are never logged.
- **Untrusted content.** Email text and tool results are data. Tool descriptions are fixed by the system.

## Signing in

Registration and sign-in are the same flow and there are no passwords. A user enters an email address and the API emails a six-digit code that expires after ten minutes. Entering the code signs the user in and creates the account if the address is new. A user may then save a first and last name on the profile page. The API protects its routes with the `requireUser` middleware, which sets `userId` from the session cookie, and every query for user data is scoped by that ID.

In development, emails are delivered to Mailpit and can be read at http://localhost:58025.

## Observability

Anvia Lens records every agent run, LLM call, MCP call and pipeline stage as a span correlated by message id. Telemetry is redacted by default, so full email bodies, prompts and replies are not exported unless explicitly enabled. Evaluation cases run against the Reply Agent, and their results link to traces. Failed evaluations and rejected drafts become new cases.

## Shared packages

| Package                | Purpose                     |
| ---------------------- | --------------------------- |
| `@leren/db`            | Database client and schema  |
| `@leren/vector-db`     | Vector store abstraction    |
| `@leren/queue`         | Durable queues with retries |
| `@leren/email`         | Email sending over SMTP     |
| `@leren/auto-reply`    | Rule status and conditions  |
| `@leren/agents`        | Contracts for AI agents     |
| `@leren/observability` | Logging                     |
| `@leren/ui`            | Shared React components     |

## Current limitations

Jobs run on RabbitMQ and survive worker restarts. The API publishes only `knowledge.index` so far, and the idempotency helper has only an in-memory store until the pipeline tables exist. The roadmap in [`../plans/0001-auto-reply-roadmap.md`](../plans/0001-auto-reply-roadmap.md) lists the order in which the rest of this design is built.
