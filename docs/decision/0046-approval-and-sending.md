# 0046. Approval, rejection and sending of replies

- Status: Accepted
- Date: 2026-11-23
- Affects: packages/db, packages/inbox, packages/channels, apps/api, apps/worker, apps/platform, docs/overview/README.md, docs/plans/0001-auto-reply-roadmap.md

## Context

The reply pipeline saves a draft in `reply_decisions` and moves the message to `drafted` ([0043](0043-reply-decisions-and-the-process-consumer.md)). Nothing shows the draft to the user, nothing sends it, and a message in `drafted` has no way out, because the status is final. Product decision [0001](../product/0001-reply-mode-draft-or-send.md) says that a reply waits for the user in `draft` mode and is sent at once in `send` mode, and that the reply sender is the only part that sends. The Gmail account was connected with the `gmail.send` scope ([0038](0038-channel-providers-and-google-oauth.md)).

## Decision

### Which mode applies

- The mode of a reply is read when the pipeline ends, from the email conditions of the playbooks that the decision used, for the channel account of the message. The reply is sent without approval only when every one of those playbooks is in `send` mode. A playbook that is in `draft` mode, or that no longer exists, makes the reply a draft. An escalation and a message that is not for the user have no reply and are not affected.
- In `send` mode the consumer of `email.process` records an automatic approval and publishes `email.send`. In `draft` mode it leaves the message in `drafted`, where it waits for the user.

### The draft and the decision of the user

- `reply_decisions` gets the columns `approved_at`, `approved_by` (`user` or `playbook`), `edited_body`, `rejected_at`, `rejection_reason`, `sent_at`, `sent_message_id` and `send_error`. The text that is sent is `edited_body` when it is set, and `body` otherwise.
- A new status `rejected` means that the user rejected the draft. `drafted` may move to `sent`, `rejected` and `failed`, and `rejected` is final. Approving does not change the status. A draft that is approved and not yet sent stays `drafted` with `approved_at` set, and the interface shows it as sending.
- The API gets these routes, all scoped to the signed-in user, and the id in them is the id of the message:
  - `GET /api/drafts` lists the drafts that wait for the user, which are the messages in `drafted` with no `approved_at`, newest first, with cursor paging.
  - `GET /api/drafts/:id` returns the message, the draft, the playbooks it cites and a summary of the evaluation.
  - `POST /api/drafts/:id/approve` takes an optional edited body. It is one conditional update that sets `approved_at` and `edited_body` only while the draft waits, and then publishes `email.send` with the message id as the idempotency key. Approving a draft that was already approved changes nothing and returns its state.
  - `POST /api/drafts/:id/reject` takes a reason and sets `rejected_at`, the reason and the status `rejected`, only while the draft waits.
- An edited body is limited to the length of a drafted body and may not be empty. The output guardrail of decision 0042 is not run on text that the user wrote.
- The escalated messages are listed by `GET /api/messages` with the status filter, and the interface shows them next to the drafts. A reply to an escalated message is written outside the product in this version.

### The sender

- A worker job consumes `email.send` in the `processor` role of [0045](0045-worker-roles.md). It reads the current records and does nothing when the message is not `drafted`, has no `approved_at`, or has a `sent_at`, so a repeated delivery changes nothing.
- The provider interface gets `sendReply`. For Gmail it builds a plain text message and sends it with the `threadId` of the original, so that the reply joins the thread. The reply goes to one recipient only, the sender of the original, or its `Reply-To` address when it has one. It never has Cc or Bcc recipients. The subject is the subject of the original with `Re: ` in front, unless it starts with it. `In-Reply-To` and `References` come from the `Message-ID` header of the original, which the provider reads from the original message when it sends.
- The sender refuses to send, and marks the message `failed` with the reason `send_refused`, when the original is bulk mail, or its sender is an address of the account itself. This keeps a reply from reaching a list or from starting a loop.
- A send is not idempotent at the provider. The reply carries a `Message-ID` header that the sender builds from the message id. Before a retry, the provider looks for that header in the sent mail of the account, and when it finds one, the sender records it as sent and does not send again. This closes the window in which a send succeeded and the record of it was lost. Whether Gmail keeps a `Message-ID` that the caller supplies must be checked when this is built, and if it does not, the check searches by thread and time instead.
- A failure is retried with backoff. A rate limit is retried. A failure that cannot succeed on a retry, such as a revoked token or an address that Gmail refuses, is not retried: the account of a revoked token becomes `revoked`, and the message becomes `failed` with `send_failed` and the error stored in `send_error`. When the last attempt fails the message also becomes `failed`.
- On success the sender stores `sent_at` and `sent_message_id`, and then moves the message to `sent`. The two writes are separate and each is safe to repeat.

### The approval inbox

- The platform gets an inbox page that lists the waiting drafts and the escalated messages. Opening a draft shows the original email, the draft, the playbooks it cites and what the evaluator found, and the user may approve it, edit it and approve it, or reject it with a reason. The page uses the `ApprovalQueue` and `DraftReview` components of the design system.
- The notifications that tell the user about an escalation or a failed send are a later step of this feature and need an email sender in the worker. Until then, the inbox and the status filter of the message list are the places to look.

### What is not decided here

- Attachments, replies to more than one recipient, and replies in channels other than email.
- A limit on how many replies an account may send for each hour. It is worth adding before `send` mode is used on real mail, and it needs its own decision.

## Consequences

- A rejected draft and an edited draft are stored with the reason and the edit, so they can become evaluation cases for the pipeline.
- A reply in `send` mode reaches the recipient before the user can correct it, as product decision 0001 says. The checks of the pipeline are the only guard.
- A message in `drafted` that the user never approves stays in the inbox. Nothing expires it in this version.
- The status `rejected` is new and the API filter accepts it. The overview and the roadmap say so.
- The original sender of a message is read from the record, so a reply cannot go to an address that the model wrote.
