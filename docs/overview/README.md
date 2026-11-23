# High-level design

Leren is an AI email assistant. The user defines **playbooks** that say what the assistant may say and when it replies. While a playbook is in effect, incoming work email is classified and then answered from enabled playbooks, delegated, ignored or escalated. By default a reply is saved as a draft, and a person approves it before it is sent. A user can choose to send the replies of a playbook without approval (product decision 0001).

## Components

| Component  | Role                                                                                                              |
| ---------- | ----------------------------------------------------------------------------------------------------------------- |
| `platform` | The web application: playbook management, an optional assistant chat, a message log, a dashboard.                 |
| `api`      | The only service that reads or writes PostgreSQL and Qdrant. It validates every request and hosts the MCP server. |
| `worker`   | Runs the queue consumers: email listener, gate, pipeline runner and reply sender.                                 |
| RabbitMQ   | Durable queues between the stages, with retries and dead-letter queues.                                           |
| PostgreSQL | The source of truth for users, playbooks, messages, decisions and drafts.                                         |
| Qdrant     | The vector index of enabled playbooks, accessed through `@leren/vector-db`.                                       |
| Anvia      | The agent framework for both agents, and Lens for tracing and evaluation.                                         |

## Playbooks

A **playbook** says when the assistant replies and what it says. It has two parts that the web interface shows as the tabs **Knowledge** and **Rules**.

The knowledge part has a topic, a response that the assistant may give, optional example messages that help find the playbook, restrictions on what must not be said, and optional **contacts**, the email addresses or handles of the people a reply may point to.

The rules part has an optional start, an optional end, a timezone and conditions for each channel. For email, the conditions say:

- Which senders are answered: anyone, or only listed addresses and domains.
- Which recipient roles are answered: To, Cc or Bcc. A message is Bcc when the user's address is in neither the To nor the Cc header.
- Whether the user must be the only recipient when addressed in the To header.
- Whether a message that mentions the user by name is answered even when the role or the recipient count would otherwise exclude it. Names are matched against the user's name and a list of aliases. A playbook can also ask a model to decide when no alias matches.
- Whether new threads, replies in an existing thread, or both are answered.
- Whether mailing lists and automatically generated messages are skipped.
- What happens to a reply: it is created as a draft in the user's mailbox, which is the default, or it is sent without approval. The assistant cannot change this setting, and the user chooses it on the Rules tab (product decision 0002 and decision 0039).

## Enabling and derived status

A playbook is enabled or disabled. The assistant may use a playbook only when it is enabled and the current time is inside its period. The user turns a playbook on or off in the list. A playbook that is on must name the connected email account that it answers on, because the gate passes an email only to the playbooks of the account that received it. The API refuses to save or turn on a playbook without one, the assistant uses the user's only account when it creates a playbook, and the list marks a playbook that is on and has none as "No mailbox" (decision 0044).

The period status is computed from the start, the end and the current time. It is never stored.

| Status      | Condition                 |
| ----------- | ------------------------- |
| `scheduled` | Now is before the start.  |
| `active`    | Now is inside the period. |
| `expired`   | Now is after the end.     |

A missing bound is open, and both bounds are inclusive. The interface shows one status for each playbook: `disabled`, and for an enabled playbook its period status.

## Channels and accounts

A **channel** is a kind of medium that messages arrive on, such as email or Slack. A user connects a **channel account** with OAuth, for example a Gmail mailbox. A message belongs to the user who owns the account it was fetched through. The address the user signs in with is not used to match messages, and it can differ from every connected address.

A user has many playbooks. A playbook listens on a channel when it has the conditions for that channel, and those conditions name the channel account to listen on. A user connects and disconnects accounts on the Channels page, and chooses the account of a playbook on its Rules tab. A user can have one email account in the first version, and an account cannot belong to two users.

The providers that users can connect are chosen by the `CHANNEL_PROVIDERS` environment variable, a comma-separated list such as `google,mailpit`. It is empty by default, so no account can be connected until a provider is enabled. `google` connects a Gmail or Google Workspace mailbox and needs `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `CHANNEL_TOKEN_ENCRYPTION_KEY`. `mailpit` connects the development mailbox without OAuth and is refused in production. When a provider is removed from the list, its accounts stop being used, and they work again when it is added back. Decisions 0021 and 0038 specify this. The worker reads new mail from a Gmail mailbox every `EMAIL_POLL_INTERVAL_SECONDS` seconds, 60 by default, and records only mail that arrives after the account is connected. Mail that arrives while an account is disconnected or revoked is not read later. While `mailpit` is enabled, `POST /api/messages/simulate` records an email as if the mailbox had received it.

## Agents

The platform UI is the main way to manage data. The assistant is an optional helper beside it. The two agents never share a prompt, a tool set or a session.

|             | Assistant Agent                                                                    | Reply Agent                                          |
| ----------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Started by  | The user, from the chat page in the platform.                                      | A queued email job.                                  |
| Purpose     | Look up saved data, generate example questions, refine wording and point out gaps. | Decide how to handle one email and draft the output. |
| Writes      | Creates and changes playbooks after the user confirms.                             | A draft reply or a decision record. It cannot send.  |
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

The UI is the primary path. The assistant reads saved data and, after the user confirms, creates and changes playbooks through the same services the UI uses. The assistant asks for confirmation in the chat before it saves anything. That is a rule in its prompt and code does not enforce it (decisions 0034 and 0036). The chat is a full page that the sidebar opens with New chat. The sidebar lists earlier chats below the menu, and a chat's history is the agent's memory (decision 0034).

## Flow B: incoming email

```
Email provider
   │ poll
   ▼
Email listener ─▶ message record (status: received) ─▶ [email.received]
                                │
                                ▼
                       Gate (worker, code only)
                         - duplicates are one record, by provider message id
                         - find the user's active playbooks for the account
                         - none handles it: status "not applicable", with the reason, and stop
                         - otherwise status "queued"
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
                          [email.deliver] ─▶ Reply deliverer (worker) ─▶ Email provider
                                                   draft mode: a draft in the user's mailbox
                                                   send mode: the reply is sent
```

Whether an email is handled at all is decided by the gate, in code, from stored playbooks and their conditions. The Reply Agent is never asked whether to reply to a message outside an active playbook. The gate makes no model call. The optional mention check of a playbook that asks for it is made by the pipeline, and the gate passes such a playbook on with the verdict `check_mention`.

## Reply pipeline

The pipeline runner does not call the Reply Agent directly. It runs one message through fixed stages (decision 0042):

```
input guardrail ─▶ triage ─▶ retrieve ─▶ route ─▶ draft ─▶ evaluate ⇄ revise ─▶ output guardrail ─▶ persist
                               │                                  │ failed twice
                               │ no reliable result               ▼
                               └──────────────────────────▶ escalate, with the reasons
```

- **Guardrails** are code. They treat the email as untrusted data and block credentials, answers without citations and a repeated system prompt.
- **Retrieve** calls the `search_playbooks` MCP tool for each question in the email. When nothing reliable is found for any of them, the pipeline escalates and does not call the drafting agent.
- **Draft** is the Reply Agent. It cites the playbooks it used and follows the user's reply instructions, such as a persona or a tone.
- **Evaluate** checks the draft against the retrieved playbooks, their restrictions and contacts, and the reply instructions, and that every question is answered or explicitly deferred. A draft that fails goes back for at most 2 revisions. A draft that still fails is escalated, never saved as a reply.
- **Persist** saves the decision and the draft and moves the message status. Nothing in the pipeline sends email.

## Message records

Every received email has one record, so the user can see in the dashboard what arrived and where it stands. A record holds the channel, the provider and the provider's message and thread ids, the sender, the recipients, the subject, a body that is cut at 20,000 characters and the time it was received. It holds no attachments, headers or credentials.

The status is updated as the message passes through the pipeline, and it only moves forward.

| Status           | Meaning                                                |
| ---------------- | ------------------------------------------------------ |
| `received`       | The email is recorded and waits for the gate.          |
| `not_applicable` | No playbook handles it. The reason is stored with it.  |
| `queued`         | The gate passed it to the pipeline.                    |
| `processing`     | The pipeline is working on it.                         |
| `drafted`        | A reply is ready. In draft mode it is in the mailbox.  |
| `escalated`      | The user must handle it. The reason is stored with it. |
| `sent`           | A reply was sent.                                      |
| `failed`         | A step failed. The reason is stored with it.           |

The result of the pipeline for each message, with its draft, is stored in `reply_decisions` (decision 0043). When a playbook asks for a mention check and the email does not address the user, the message becomes `not_applicable` with the reason `not_addressed`.

`GET /api/messages` lists the user's records, newest first, and takes `status`, `channel`, `channelAccountId`, `limit` and `cursor`. Each item has the `outcome` and the `deliveryState` of its decision, which are null until the pipeline has decided. `GET /api/messages/:id` returns one record with its stored body and its whole decision: the reply, the cited playbooks, the reasons, the evaluations and the delivery record (decisions 0039 and 0046).

## Worker roles

The worker runs the roles that `WORKER_ROLES` lists, separated by commas. An empty or unset value runs every role, and an unknown name stops the process at startup (decision 0045).

| Role        | Starts                                                                                                           |
| ----------- | ---------------------------------------------------------------------------------------------------------------- |
| `listener`  | The timer that requests mailbox polls, and the `email.poll` job.                                                 |
| `processor` | The `email.received` gate, the `email.process` reply run, the `email.deliver` deliverer and the `run-agent` job. |
| `indexer`   | The `knowledge.index` and `knowledge.drift` jobs, and the timer of the drift check.                              |

A variable that only one role uses is required only when that role starts. The `indexer` role needs `VECTOR_STORE_URL` and an embedding model, and the `listener` and `processor` roles need the settings of the enabled channel providers, the first to read mailboxes and the second to write replies to them. A process whose only role is `processor` stops at startup when the reply pipeline cannot be built, and a process with other roles logs a warning and goes on without it. Two processes of one role each run the timers of that role, which is safe, because a poll and a drift check can be repeated.

## Queues

The queues are `email.poll`, `email.received`, `email.process`, `email.deliver`, `knowledge.index` and `knowledge.drift`, each with a dead-letter queue named `<queue>.dlq`. A failed message is retried with exponential backoff and moved to the dead-letter queue when its attempts are used up. A consumer acknowledges a message only after its work is durable. Every message carries an idempotency key, and every handler is safe to retry.

## Knowledge indexing

Only an enabled playbook whose period has not ended is searchable. Each such playbook has one vector in the Qdrant collection `knowledge`, and the vector id is the playbook id. The text that is embedded is the topic, the response and the examples. The payload holds the playbook and user ids, the type, the period and the `updatedAt` of the row that the vector was built from.

When the API creates, edits, enables, disables or deletes a playbook, it publishes the playbook id to `knowledge.index`. The worker reads the current row and makes the index match it, so a repeated or reordered message does no harm. A periodic `knowledge.drift` job compares PostgreSQL with Qdrant, repairs any difference and removes the vectors of expired playbooks. Embeddings come from an OpenAI-compatible endpoint, which is OpenRouter by default (decision 0024).

## Knowledge retrieval

`searchKnowledge` embeds a message and returns up to five playbooks for one user, best match first, or an explicit `no_reliable_result` when nothing usable scores above the threshold. The index only proposes candidates. PostgreSQL decides whether each one exists, is enabled and is valid now, and supplies the content that is returned (decision 0028).

## MCP server

The MCP server lives in `api` and exposes tools, resources and prompts. It is the integration surface of the system. It is not private to the two built-in agents, so a user could later connect their own agent instead of using the assistant.

- **Scopes.** Tools are grouped into scopes such as `playbooks:read`, `playbooks:write` and `reply:draft`. A session receives only the scopes granted to its client. The Assistant Agent and the Reply Agent are built-in clients with fixed scopes.
- **Neutral tools.** Tool names and schemas do not depend on our prompts or agent framework.
- **Confirmed writes.** The assistant asks the user to confirm in the chat before it calls a write tool. This is a prompt rule and not a mechanism, and a playbook it saves takes effect at once. No agent can send email.

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

Anvia Lens records every agent run, LLM call, MCP call and pipeline stage as a span correlated by message id. A trace holds the prompts, the replies and the input and output of each stage, so the email, the playbooks and the reply can be read in Lens. The observer turns on the redaction of the library, so email addresses and phone numbers appear as `[redacted]`, and the Lens server stores the rest of the text of the emails (decision 0047). Evaluation cases run against the Reply Agent, and their results link to traces. Failed evaluations and escalated messages become new cases.

## Shared packages

| Package                | Purpose                      |
| ---------------------- | ---------------------------- |
| `@leren/db`            | Database client and schema   |
| `@leren/vector-db`     | Vector store abstraction     |
| `@leren/queue`         | Durable queues with retries  |
| `@leren/email`         | Email sending over SMTP      |
| `@leren/auto-reply`    | Period status and conditions |
| `@leren/inbox`         | Message records and statuses |
| `@leren/channels`      | Channel providers and tokens |
| `@leren/agents`        | Contracts for AI agents      |
| `@leren/observability` | Logging                      |
| `@leren/ui`            | Shared React components      |

## Current limitations

Jobs run on RabbitMQ and survive worker restarts. The API publishes `knowledge.index` and `email.received`, and the worker publishes `email.process`, which nothing consumes yet. The idempotency helper has only an in-memory store, and the message record is what makes recording an email idempotent. The roadmap in [`../plans/0001-auto-reply-roadmap.md`](../plans/0001-auto-reply-roadmap.md) lists the order in which the rest of this design is built.
