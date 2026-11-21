# 0021. Channels and channel accounts

- Status: Accepted
- Date: 2026-11-20
- Affects: packages/db, apps/api, apps/worker, apps/platform, docs/overview/README.md, docs/plans/0001-auto-reply-roadmap.md

## Context

The gate must know which user an incoming message is for. The address that a user signs in with ([0013](0013-better-auth-email-code.md)) is only a login and can differ from every mailbox the user wants the assistant to watch. `auto_reply_rules.user_id` ties a rule to a user, but nothing ties a message to a user.

The product will listen on more than email, for example Slack. A user can have many rules, a rule can have many knowledge items, and each rule can listen on different channels. The first version needs one email account for each user, and the structure must allow more accounts and more channels later without reworking the tables that exist.

## Decision

- A **channel** is a kind of medium that messages arrive on: `email` or `slack`. A **channel account** is a user's authorised account on a channel, such as one Gmail mailbox or one Slack workspace.
- Store channel accounts in a `channel_accounts` table with the user, the channel, the provider, the provider's identifier of the account, a display label, encrypted credentials and a status. It is unique on channel, provider and the provider's identifier, so an account belongs to exactly one user. A user has many channel accounts.
- Connect an account with OAuth. The provider's consent proves that the user controls the account, so no separate verification of an address is needed. The provider and its scopes are chosen in the decision that builds the connection.
- The owner of a message is the owner of the channel account it was fetched through. The gate does not match the headers of a message against the sign-in address.
- Keep the settings of a rule for each channel in a table of its own, as decided in [0019](0019-email-reply-conditions.md). A rule listens on a channel when it has the conditions row for that channel. When channels are built, each conditions table gets a nullable `channel_account_id` that names the account the rule listens on, and the account must belong to the same user as the rule.
- A rule has no channel column, and a knowledge item belongs to its rule and not to a channel, so the same knowledge answers on every channel of the rule.
- The first version allows one email channel account for each user. The API enforces this limit and the schema does not, so lifting it needs no migration.
- People that a reply may point to are stored on the knowledge item as text, an email address or a handle such as `@Don`. They are not records tied to a user.

## Consequences

- No existing table changes now. Building this adds `channel_accounts` and one nullable column to `email_reply_conditions`. `users`, `auto_reply_rules` and `knowledge_items` stay as they are.
- The API that lists rules joins the conditions of each channel with an outer join once a rule can exist without email conditions. Today every rule has an email conditions row.
- Better Auth's `accounts` table stays for sign-in. Channel accounts are separate, because a login identity and a mailbox grant different permissions and have different lifetimes.
- Tokens that grant access to a mailbox are secrets. They are encrypted at rest, never logged, and revoked at the provider when the user disconnects the account.
- A message that arrives on an account whose status is not active, for example after the user revoked access, is not processed.
