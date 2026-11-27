# 0062. Channel accounts connected by OAuth or by signing in to the mail server

- Status: Accepted
- Date: 2026-11-27
- Affects: packages/db, packages/channels, apps/api, apps/worker, apps/platform, docs/overview/README.md

## Context

[0021](0021-channels-and-channel-accounts.md) defines channels and channel accounts, and it requires every account to be connected with OAuth, because the provider's consent proves that the user controls the account. Many businesses use the mailbox that comes with their domain or their web hosting. Such a mailbox is reached with IMAP and SMTP and a user name and password, and its host offers no OAuth. [0063](0063-imap-smtp-provider.md) adds a provider for these mailboxes, so the rule that every account is connected with OAuth no longer holds. The rest of 0021 is unchanged and is restated here so that this decision replaces it.

## Decision

- A **channel** is a kind of medium that messages arrive on: `email` or `slack`. A **channel account** is a user's authorised account on a channel, such as one Gmail mailbox or one Slack workspace.
- Store channel accounts in a `channel_accounts` table with the user, the channel, the provider, the provider's identifier of the account, a display label, encrypted credentials and a status. It is unique on channel, provider and the provider's identifier, so an account belongs to exactly one user. A user has many channel accounts.
- Connect an account in one of two ways, and the provider decides which:
  - **OAuth.** The provider's consent proves that the user controls the account.
  - **Signing in to the mail server.** The user gives the server's settings and the account's password, and the API signs in to the server before it saves the account. A successful sign-in proves that the user controls the account.

  In both cases no separate verification of an address is needed. The provider, its scopes or its settings are chosen in the decision that builds the connection.

- The owner of a message is the owner of the channel account it was fetched through. The gate does not match the headers of a message against the sign-in address.
- Keep the settings of a rule for each channel in a table of its own, as decided in [0019](0019-email-reply-conditions.md). A rule listens on a channel when it has the conditions row for that channel. Each conditions table has a nullable `channel_account_id` that names the account the rule listens on, and the account must belong to the same user as the rule.
- A rule has no channel column, and a knowledge item belongs to its rule and not to a channel, so the same knowledge answers on every channel of the rule.
- The first version allows one email channel account for each user. The API enforces this limit and the schema does not, so lifting it needs no migration.
- People that a reply may point to are stored on the knowledge item as text, an email address or a handle such as `@Don`. They are not records tied to a user.
- An account becomes `revoked` when its credentials stop working: when the provider rejects a refresh token, or when the mail server rejects the stored password. Only connecting the account again makes it active.

## Consequences

- Better Auth's `accounts` table stays for sign-in. Channel accounts are separate, because a login identity and a mailbox grant different permissions and have different lifetimes.
- Tokens and passwords that grant access to a mailbox are secrets. They are encrypted at rest and never logged. Tokens are revoked at the provider when the user disconnects the account. A password cannot be revoked by the product, so disconnecting deletes it, and only the user can change it at the mail server.
- A message that arrives on an account whose status is not active, for example after the user revoked access, is not processed.
- The connection page shows a form for a provider that signs in to a mail server, and a button that leaves for the provider's consent page for an OAuth provider.
