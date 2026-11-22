# 0040. The email listener and polling

- Status: Superseded
- Date: 2026-11-22
- Affects: packages/channels, packages/db, packages/inbox, apps/api, apps/worker, .env.example, docs/overview/README.md, docs/plans/0001-auto-reply-roadmap.md, docs/rules/packages.md
- Superseded by: [0041](0041-email-listener-cursor-and-unreadable-mail.md)

## Context

[0038](0038-channel-providers-and-google-oauth.md) leaves the message operations of an email provider to the feature that ingests email, and [0039](0039-email-record-reply-mode-and-gate.md) records a message and gates it, but only a simulated message reaches the record today. Reading a real mailbox runs in the worker, because it is background work on a schedule. The code that decrypts credentials and refreshes tokens lives in `apps/api`, and apps may not import each other (0017).

## Decision

- A new package, `@leren/channels`, holds the channel provider interface, the registry, the Google and Mailpit adapters, the encryption of credentials and the function that returns a valid access token for an account. `apps/api` and `apps/worker` both use it. The API's connection routes and their behaviour are unchanged.
- An email provider implements `EmailProvider`, which extends `ChannelProvider` with one operation, `fetchNewMail(tokens, cursor)`. It returns the new messages as `InboundEmail` values, the same shape that `@leren/inbox` records, and the cursor to resume from. A provider that cannot read a mailbox, such as `mailpit`, does not implement it, and the poller skips its accounts.
- `channel_accounts` gets a nullable `sync_cursor` text column. The cursor is opaque to everything except the provider that wrote it. For Google it is the Gmail `historyId`.
- The listener **polls**. It needs no public endpoint, no Pub/Sub topic and no watch renewal, and a missed poll is repaired by the next one. A timer in the worker publishes `email.poll` every `EMAIL_POLL_INTERVAL_SECONDS` seconds, which is 60 by default, once for each account that is active and whose provider is enabled. The job for one account is idempotent.
- The poll job of an account loads a valid access token, calls `fetchNewMail`, records each message with `recordInboundEmail`, and then stores the new cursor. The cursor is stored after every message is recorded, so a failure repeats messages that are already recorded and loses none. Recording is idempotent, so repeating a message changes nothing. A message that Gmail reports as not found, because it was deleted after it arrived, is skipped. Any other failure to read a message fails the job, which the queue retries, and the cursor does not advance. The cursor is written only when the stored cursor is still the one the job read, so overlapping polls of the same account never move it backwards.
- The first poll of an account that has no cursor stores the provider's current cursor and records nothing. Connecting an account, including connecting it again after it was revoked or disconnected, clears `sync_cursor`. The listener therefore ingests **only mail that arrives after the account is connected**, and it never answers mail that was already in the mailbox.
- If Gmail answers that the stored `historyId` is too old to resume from, the poll stores the current `historyId`, logs the gap, and records nothing for it. Mail that arrived during the gap is not ingested.
- The Google adapter lists new messages with `users.history.list`, using `labelId` `INBOX` and `historyTypes` `messageAdded`, and reads every page of the response. The new cursor is the top-level `historyId` of the last page. It then reads each message in full. It skips a message that carries the `SENT` or `DRAFT` label, so the account's own mail is never ingested. It uses the `gmail.readonly` scope that 0038 already requests.
- The adapter turns a Gmail message into an `InboundEmail`. The body is the `text/plain` part, or the text of the `text/html` part when there is no plain text. Attachments are ignored. `providerMessageId` and `providerThreadId` are the Gmail ids. `isReply` is true when the headers carry `In-Reply-To` or `References`. `isBulk` is true when the headers carry `List-Unsubscribe`, `Precedence` of `bulk`, `list` or `junk`, or `Auto-Submitted` other than `no`. Truncation is applied by `recordInboundEmail`, not by the adapter.
- The worker reads the same configuration as the API for providers: `CHANNEL_PROVIDERS`, the variables of each enabled provider and `CHANNEL_TOKEN_ENCRYPTION_KEY`. It fails at startup under the same conditions as the API. The refresh of a token by the worker and by the API can overlap. The last write wins, and both writes hold a valid token.
- When the provider rejects the refresh token, `getAccessToken` marks the account `revoked`, as it does today, and the poll ends without error. A revoked account is not polled again until the user connects it again.
- `mailpit` stays a provider for development without a listener. A developer injects mail with `POST /api/messages/simulate`.

## Consequences

- The poller delays a message by at most one interval plus the time to process it. A shorter interval costs more Gmail quota and a longer one delays replies.
- A message that arrives while the account is disconnected, revoked or in a gap is not ingested later. The product states this in the overview.
- Moving the provider code into `@leren/channels` changes imports in `apps/api` and adds a package to document in `docs/rules/packages.md`.
- Gmail push notifications are not used. A later decision can add them in front of the same poll job to reduce delay, and it does not change the record or the gate.
- `gmail.readonly` is a restricted scope (0038). Until the Google project is verified, only listed test users can connect, and their refresh tokens expire after seven days, so the poller of a test account stops until the user connects it again.
