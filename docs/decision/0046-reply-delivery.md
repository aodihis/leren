# 0046. Delivery of replies: a record before the call, mailbox drafts and sending

- Status: Accepted
- Date: 2026-11-23
- Affects: packages/db, packages/inbox, packages/channels, apps/api, apps/worker, apps/platform, docs/overview/README.md, docs/plans/0001-auto-reply-roadmap.md

## Context

The reply pipeline saves a reply in `reply_decisions` and moves the message to `drafted` ([0043](0043-reply-decisions-and-the-process-consumer.md)). Nothing delivers it. Product decision [0002](../product/0002-draft-mode-creates-a-mailbox-draft.md) says that in `draft` mode the reply is created as a draft in the user's mailbox, that in `send` mode it is sent at once, and that the reply deliverer is the only part that does either. Creating a draft needs a Gmail scope that the accounts do not have ([0038](0038-channel-providers-and-google-oauth.md)), and the status `drafted` is final in [0039](0039-email-record-reply-mode-and-gate.md).

A call that creates a draft or sends a mail cannot be repeated safely, and its provider gives no idempotency key. A call whose answer is lost leaves us not knowing whether it happened. How to resolve that is not known well enough yet. What is known is that we must be able to tell, afterwards, which messages were in that state, and what we tried to send.

## Decision

### Which mode applies

- The mode of a reply is read when the pipeline ends, from the email conditions of the playbooks that the decision used, for the channel account of the message. The reply is sent only when every one of those playbooks is in `send` mode. A playbook that is in `draft` mode, or that no longer exists, makes the reply a draft. An escalation and a message that is not for the user have no reply and are not delivered.
- The consumer of `email.process` stores the mode on the decision as `delivery_mode`, sets `delivery_state` to `pending`, and publishes `email.deliver` for an answer or a delegation, with the message id as the idempotency key. The message is already `drafted` at that point, as decision 0043 says. A message that is `drafted` and whose decision is still `pending` publishes `email.deliver` again when its `email.process` job is delivered again, so that a stop between the move to `drafted` and the publish loses nothing. The repeated publish is safe, because only one delivery can move the state from `pending` to `started`.

### The delivery record

- `reply_decisions` gets these columns: `delivery_mode` (`draft` or `send`), `delivery_state`, `delivery_request`, `delivery_response`, `delivery_attempts`, `delivery_started_at`, `delivery_finished_at`, `mailbox_draft_id`, `sent_message_id` and `delivery_error`.
- `delivery_state` is `pending` when the delivery is queued, `started` when the deliverer is about to call the provider, `completed` when the provider answered and its id is stored, and `failed` when the delivery ended with an error that is stored.
- The deliverer writes the record **before** it calls the provider. In one conditional update it moves the state from `pending` to `started`, adds one to `delivery_attempts`, sets `delivery_started_at` and stores the exact reply in `delivery_request`: the recipient, the subject, the body, the thread, the headers and the mode. Everything that can fail before the call, such as the refresh of the token and the read of the `Message-ID` of the original, happens before this write, so that such a failure leaves no `started` record. Only after the provider answers does it store the draft id or the sent message id, which the provider returns in the answer of both calls, together with the whole answer in `delivery_response`, set `delivery_finished_at` and move the state to `completed`. For a draft the answer holds the id of the draft and the id of the message inside it, and for a sent mail it holds the id, the thread and the labels of the message. A failure that it can read is stored in `delivery_error` with the state `failed`.
- A delivery that was `started` and has no end is therefore visible as one, with the time it started and the exact reply that was in flight. This is the information that is needed to see how often it happens and what each case looked like.
- The way to resolve a delivery whose outcome is unknown is **not decided here**. A delivery is unknown when the state is `started` and the call may have reached the provider: the answer was lost, the call timed out, or the connection was reset after the request was sent. Until it is decided, the deliverer never calls the provider again for such a delivery. A job that finds the state `started` moves it to `failed` with the error `delivery_unknown`, keeps the request and the times, and moves the message to `failed`. A person looks at the mailbox and decides. This means that a delivery is made at most once.
- Every reply carries a `Message-ID` header that the deliverer builds from the message id, so that a delivered reply can be found in the mailbox later. Nothing relies on it yet. Whether Gmail keeps a `Message-ID` that the caller supplies is observed from these records and is not assumed.

### The statuses

- No status is added. `drafted` means that a reply is ready. It may now move to `sent` and to `failed`. In `draft` mode the message stays `drafted` after the draft is created in the mailbox, and the delivery record says that the draft exists.

### The deliverer

- A worker job consumes `email.deliver` in the `processor` role of [0045](0045-worker-roles.md). It reads the current records and does nothing when the message is not `drafted`, or the state is `completed` or `failed`. A state of `started` ends as the rule above says.
- The provider interface gets `createDraft` and `sendReply`. Both take the same reply. For Gmail the reply is a plain text message that goes into the thread of the original through its `threadId`. It has one recipient, the sender of the original, or its `Reply-To` address when it has one. It has no Cc and no Bcc recipient. The subject is the subject of the original with `Re: ` in front, unless it starts with it. `In-Reply-To` and `References` come from the `Message-ID` header of the original, which the provider reads from the original message when it delivers. The text is `body` of the decision.
- In `draft` mode the deliverer creates the draft, stores `mailbox_draft_id` and leaves the message `drafted`. In `send` mode it sends the reply, stores `sent_message_id`, and moves the message to `sent`.
- The deliverer refuses to deliver, and moves the message to `failed` with the reason `delivery_refused` and the state `failed`, when the original is bulk mail, or its sender is an address of the account itself. This keeps a reply from reaching a list or from starting a loop.
- A failure that is known not to have reached the provider, such as a refused connection, a failed name lookup or a rate limit answer, puts the state back to `pending` and the job is retried, so that `delivery_attempts` counts the real attempts. A failure that the provider reports and that cannot succeed on a retry is not retried: a revoked token makes the account `revoked`, and a missing permission or an address that Gmail refuses ends with the state `failed`, the message `failed` and the error stored.

### The permission to create drafts

- The Google scopes become `openid`, `email`, `gmail.readonly`, `gmail.send` and `gmail.compose`. The last one is what creating a draft needs.
- An account that was connected before this decision does not have it, and its deliveries fail with the error stored on the decision. The user connects the account again. Connecting again replaces the credentials and sets the mailbox cursor to the current position, as decision 0041 says, so mail that arrived before the user connected again is not read.

### The processed emails page

- The platform gets a menu item, **Processed emails**, that shows what the assistant did with each email. It lists the messages, newest first, with the sender, the subject, the time, the status, the outcome and the delivery state, and filters them by status. Opening one shows the email, the reply, the playbooks that it cites, the reasons and what the evaluator found, and the delivery: the mode, the state, the times, the attempts, the id of the draft or of the sent message, the whole answer of the provider, the error and the stored request. The page uses the `ActivityTable` component of the design system.
- `GET /api/messages` adds the outcome and the delivery state of the decision to each item, and `GET /api/messages/:id` returns the whole decision with the message. Both are scoped to the signed-in user and are read only.
- The page has no action. The user acts on a draft in the mailbox.

### What is not decided here

- How to resolve a delivery that is `started` and has no end, and whether a delivery may be repeated by a person.
- Detecting that the user sent, changed or deleted a draft. The id of the draft may be enough: a lookup of the draft that the provider answers with "not found" means that the user sent it or deleted it, and a look at the message that was inside it, for the label that marks sent mail, would tell the two apart. This has not been checked against Gmail.
- Email notifications for an escalation or a failed delivery, which need an email sender in the worker.
- A limit on how many replies an account may send for each hour. It is worth adding before `send` mode is used on real mail, and it needs its own decision.
- Attachments, replies to more than one recipient, and channels other than email.

## Consequences

- Each delivery leaves a record of what was about to be sent and of how far it got, so a duplicate or a lost reply can be investigated afterwards with facts.
- A delivery whose answer was lost is never repeated by the product, and it needs a person. It is visible on the processed emails page as `failed` with `delivery_unknown`.
- A reply in `send` mode reaches the recipient before the user can correct it, as product decision 0002 says. The checks of the pipeline are the only guard.
- The page shows the text of the emails and of the replies to the user who owns them, and nobody else.
- A draft in the mailbox that the user ignores stays there. Nothing expires it.
- The recipient of a reply is read from the record of the original, so a reply cannot go to an address that the model wrote.
