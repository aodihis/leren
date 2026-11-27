# 0065. Several email accounts for each user

- Status: Accepted
- Date: 2026-11-27
- Affects: apps/api, apps/worker, apps/platform, docs/overview/README.md

## Context

[0062](0062-channel-accounts-connected-by-oauth-or-sign-in.md) and [0038](0038-channel-providers-and-google-oauth.md) allow one email channel account for each user, and the API answers a second connection with the error `limit`. Users have more than one mailbox, such as a personal address and a shared address, and want the assistant to answer on each of them. The schema, the listener, the gate and the playbooks already work per account: a message belongs to the account it was fetched through, and the conditions of a playbook name the one account that the playbook listens on.

## Decision

- A user may connect up to 10 accounts on the `email` channel. The API answers a connection past that limit with the error `limit`. The limit keeps the number of mailboxes that the listener polls for one user bounded.
- The limit is counted when a new account is saved, under the lock on the user's row, so two connections at once cannot both pass it. Connecting an account that the user already has replaces its credentials and does not count against the limit.
- The gate does not handle a message whose sender is the address of any of the user's own accounts on the channel, so two mailboxes of one user that both have playbooks cannot answer each other without end.
- A playbook still listens on one account for each channel. A user who wants the same playbook on two mailboxes creates a playbook for each.
- This decision replaces 0062 and 0038. Everything else that they decide applies unchanged as they state it.

## Consequences

- Lifting or changing the limit needs no migration, because the schema has no constraint on the number of accounts.
- Each connected account is polled separately, so the work of the listener grows with the number of accounts.
- An email sent to two of the user's mailboxes is a separate message in each, and the playbooks of each mailbox may answer it, so the sender can receive two replies.
- A message is unique on the user and the provider's message id, not on the account. Two mailboxes of one provider are trusted to give different ids, and the IMAP provider adds the account to its ids for this reason.
