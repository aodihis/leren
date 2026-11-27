# 0063. IMAP and SMTP as a channel provider

- Status: Accepted
- Date: 2026-11-27
- Affects: packages/channels, packages/db, apps/api, apps/worker, apps/platform, .env.example, docs/overview/README.md

## Context

Many businesses use the mailbox that comes with their domain or their web hosting, such as cPanel hosting, Namecheap Private Email, GoDaddy, Titan, Hostinger or IONOS. These hosts offer no REST API and no OAuth. They do offer IMAP for reading a mailbox and SMTP submission for sending, with a user name and a password, so one provider can serve all of them. [0062](0062-channel-accounts-connected-by-oauth-or-sign-in.md) allows an account to be connected by signing in to its mail server.

IMAP has no notifications that reach a server across the internet, so the listener polls as for the other providers ([0041](0041-email-listener-cursor-and-unreadable-mail.md)). A mailbox numbers its messages with UIDs that only grow, and `UIDVALIDITY` changes when the numbering starts again. Together they are a cursor that cannot skip mail.

## Decision

### The provider

- The provider's name is `imap`, its channel is `email` and its display name is "Other email (IMAP)". It needs no variables of its own, and `CHANNEL_TOKEN_ENCRYPTION_KEY` is required when it is enabled.
- The adapter uses `imapflow` for IMAP, `mailparser` to read messages, and `nodemailer` to compose messages and send them over SMTP. `nodemailer` is already used by `packages/email`. The three libraries come from the same authors and are maintained.

### Connecting

- A provider declares how it connects. The OAuth providers and `mailpit` keep `start` and `finish`. The `imap` provider instead has `signIn`, which takes the settings, signs in, and returns the account. The list of providers that the API returns names the way each one connects, so the connection page shows a form for `imap`.
- The user gives the address, the user name, the password, the IMAP host and port, and the SMTP host and port. The user name is the address unless the user changes it. SMTP uses the same user name and password.
- The connection is always encrypted, with TLS from the start or with STARTTLS, and a plain connection is refused. The IMAP port is 993 or 143 and the SMTP port is 465 or 587. Certificates are verified.
- `POST /api/channel-accounts/imap/sign-in` takes the settings. The API signs in to IMAP and opens the inbox, then signs in to SMTP without sending anything, with a limit of 15 seconds for each. Only when both succeed is the account saved, with the position of the inbox as its cursor. A failure answers with one of these error codes: `authentication_failed`, `server_unreachable`, `encryption_failed` or `host_not_allowed`.
- `GET /api/channel-accounts/imap/settings?address=` suggests settings for the domain of an address. In order, it reads the domain's `https://autoconfig.<domain>/mail/config-v1.1.xml`, Mozilla's database at `https://autoconfig.thunderbird.net/v1.1/<domain>`, and the DNS SRV records `_imaps._tcp`, `_imap._tcp` and `_submission._tcp` (RFC 6186). The user can change every suggested value. Nothing is saved.
- A user may try to sign in at most five times in fifteen minutes, so that the product cannot be used to guess passwords. A user may look up settings at most twenty times in fifteen minutes, because each lookup makes requests to hosts that the user chose. Both limits use Redis, as the MCP endpoint does ([0053](0053-redis-and-per-user-mcp-rate-limit.md)), and refuse the request when Redis cannot be reached.
- A server that refuses a sign-in for a temporary reason does not count as a rejected password. This covers an IMAP answer with the code `UNAVAILABLE`, `INUSE`, `LIMIT` or `SERVERBUG`, and an SMTP answer with a `4xx` code.

### Reaching a host that a user chose

- Every host is user input, so the API and the worker resolve it and refuse loopback, private, link-local, shared (`100.64.0.0/10`), multicast and unspecified addresses, for IPv4 and IPv6. They then connect to the address that was checked, with the host name as the TLS server name. A DNS answer that changes after the check therefore cannot point the connection elsewhere.
- The requests that suggest settings use HTTPS, follow no redirects, read at most 100 KB, and are made only to a host whose addresses pass the same check. They are not connected to the checked address, so a DNS answer that changes between the check and the request can still reach another address. Certificate verification and the fixed path keep such a request from reading anything useful.
- An account becomes `revoked` only while it still holds the credentials that the server refused, so a poll that fails after the user connected the account again leaves it active.

### The account and its credentials

- The provider's identifier of the account is the IMAP host and the user name, in lowercase and joined by a slash. Its display label is the address.
- The settings and the password are stored as JSON in the `accessToken` of the account's tokens, with no refresh token and no expiry. They are encrypted like any other credentials. `getAccessToken` therefore returns them unchanged and never refreshes them, and only this provider reads them. `revoke` does nothing.
- When the server rejects the password, the adapter throws `InvalidGrantError`. This happens when IMAP answers the sign-in with `NO` or the `AUTHENTICATIONFAILED` code, or SMTP answers with `535`. The listener and the deliverer then make the account `revoked`, as 0062 requires. Nothing was delivered, so the deliverer ends the delivery as `delivery_unavailable`.

### Reading new mail

- Each poll opens one connection, opens the inbox read-only, and closes the connection when it is done. No connection stays open between polls.
- The cursor holds the `UIDVALIDITY` of the inbox and the highest UID that was read. A poll fetches the messages in the next 100 UIDs, up to the newest, oldest first. The cursor moves to the end of that range, so a poll that reaches the limit leaves the rest to the next poll and leaves no gap.
- When `UIDVALIDITY` differs from the cursor's, the result is a baseline at the current position, which the listener records as a gap.
- Messages are fetched with `BODY.PEEK[]`, so reading them does not mark them as read.
- The sender, the recipients, the copied recipients and the subject come from the parsed message. The body is its plain-text part, or its HTML part converted to text. `isReply` and `isBulk` follow the rules of the other providers. A message that cannot be parsed is reported in `unreadable`.
- The provider message id is the provider's identifier of the account, the `UIDVALIDITY` and the UID, joined by colons. A UID is unique only within one inbox and stored messages are not keyed by account, so the identifier keeps the messages of two mailboxes of one user apart, and connecting the same mailbox again gives the same ids. The `UIDVALIDITY` and the UID are read from the end, so a user name that contains a colon does not change them. IMAP has no conversation id, so the thread id is null.

### Delivering a reply

- The reply is composed with the `Message-ID` that the deliverer built, and with `In-Reply-To` and `References` from the headers of the original, which the adapter reads by the original's UID. The id in the delivery receipt is that `Message-ID`, so it is always known.
- A draft is appended to the mailbox that has the special use `\Drafts`, or to a mailbox named `Drafts` or `INBOX.Drafts`, with the flags `\Draft` and `\Seen`.
- A reply in `send` mode is sent over SMTP. A copy is then appended to the mailbox that has the special use `\Sent`, or to one named `Sent` or `INBOX.Sent`. What happened to the copy is recorded in the response of the delivery, and a failure to append it does not change the outcome, because the mail was sent.
- The outcome of a failed delivery follows decision 0046:
  - It was not sent when the host could not be reached, the sign-in failed, or SMTP answered with a `4xx` code before the message was accepted.
  - It was rejected when IMAP answered the append with `NO`, or SMTP answered with a `5xx` code.
  - Its outcome is unknown when the connection broke after the message was handed over and before the server answered.

## Consequences

- One provider serves nearly every hosted mailbox, and also Fastmail, Yahoo and iCloud with an app password. Gmail and Microsoft 365 mailboxes should use their own providers, because those services require OAuth or app passwords.
- The product stores a mailbox password, which it cannot revoke, instead of a token. The overview advises an app password where the host offers one.
- Proton Mail cannot be connected, because it offers IMAP only through Proton Bridge, which runs on the user's own computer.
- Each poll opens a TLS connection and signs in. A host that limits sign-ins may refuse a short poll interval. IMAP `IDLE` could later start a poll when mail arrives, as a notification would for the other providers.
- A host that already copies sent mail to its Sent mailbox ends up with two copies of each reply.
- The name `accessToken` carries the settings and the password for this provider. Only `getAccessToken` and the provider handle it, and both treat it as opaque.
- Making an account `revoked` when its credentials are rejected during a poll or a delivery applies to every provider that throws `InvalidGrantError` there.
- `imapflow` and `mailparser` are new dependencies, and `packages/channels` gains `nodemailer`.
