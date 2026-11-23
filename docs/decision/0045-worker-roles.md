# 0045. The worker runs the roles that its environment names

- Status: Accepted
- Date: 2026-11-23
- Affects: apps/worker, .env.example, docs/overview/README.md, docs/plans/0001-auto-reply-roadmap.md

## Context

One worker process consumes every queue and starts every timer. Reading new mail, running the gate and the Reply Agent, sending replies and indexing knowledge have different loads and different failure modes. Reading mail is cheap and must keep going while a reply is being written. A reply run calls a model and may take a long time. [0041](0041-email-listener-cursor-and-unreadable-mail.md) plans to put Gmail push notifications in front of the same `email.poll` job, so the way mail enters the system will change, and the processing of mail should not have to change with it.

The stages already meet only at a queue message that holds a message id, and at the `messages` row that is the source of truth. What is missing is a way to run some stages without the others.

## Decision

- A worker process starts the **roles** that the environment variable `WORKER_ROLES` lists, separated by commas. An empty or unset variable starts every role, so a development setup with one process needs no change. An unknown role name stops the worker at startup, with an error that lists the valid names.
- The roles and what each one starts:
  - `listener`: the timer that requests mailbox polls, and the `email.poll` job. This is the only role that reads a mailbox.
  - `processor`: the `email.received` gate, the `email.process` reply run, the `email.deliver` deliverer and the `run-agent` job. This is the only role that calls the reply models and sends mail.
  - `indexer`: the `knowledge.index` and `knowledge.drift` jobs, and the timer that requests drift checks.
- A timer runs only in a process that has its role, so several `processor` processes never request polls, and several `listener` processes are the only ones that do. Two `listener` processes request the same polls, which is safe, because a poll that is older than two intervals is dropped and the cursor is written only if it has not moved.
- The interface between the roles is the `messages` row and the queue messages that carry its id. A queue message never holds an email body. A new way to receive mail, such as a Gmail push notification handled by the API, records mail with `recordInboundEmail` or publishes `email.poll`, and the `processor` role is unchanged.
- Configuration that only a role needs is required only when that role starts. A process without the `processor` role needs no reply model and no MCP secret. A process without the `indexer` role needs no embedding model or vector store.
- The worker logs the roles it started and the jobs that follow from them.

## Consequences

- Reading mail keeps its pace while replies are written, and the processor can be scaled on its own by running more processes.
- Moving to webhooks changes the `listener` role and the API, and nothing else.
- A deployment that starts no process with the `processor` role leaves messages in their queues until one starts, which loses nothing.
- Each queue has one kind of consumer, so a role can be moved to another process or machine without a change to the code.
