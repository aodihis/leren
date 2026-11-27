# 0064. Emails that the gate skips are not kept

- Status: Accepted
- Date: 2026-11-27
- Affects: apps/worker, packages/inbox, docs/overview/README.md, docs/overview/guide.md

## Context

[0039](0039-email-record-reply-mode-and-gate.md) records every email that arrives on a connected account and keeps the record of an email that no playbook handles, with the status `not_applicable` and the reason of the skip. Most of the mail in a mailbox is not meant for the assistant, so the table fills with the subjects, bodies and addresses of emails that Leren never processes. Keeping them has no use for the user beyond a log of what was ignored.

## Decision

- The gate deletes the record of a message that no playbook handles, instead of moving it to `not_applicable`. This covers a message that no usable playbook names, a message that the conditions of every playbook skip, and a message whose account was revoked or deleted.
- The delete is conditional on the status `received`, so a record that has already been queued and published is never deleted, and a repeated `email.received` for a deleted record does nothing.
- A `received` message can no longer move to `not_applicable`. The pipeline still moves a `processing` message to `not_applicable`, such as one that fails the mention check, because the pipeline has already considered it.
- The listener records a message before the gate decides, because the gate reads the current row. The record of a skipped message therefore exists only until the gate runs.
- This decision replaces 0039. Everything else that 0039 decides, which is the message record, the idempotency key, the status values, the reply mode and the API, applies unchanged as 0039 states it.
- Recording an email retries once when the existing record is deleted by the gate between the insert and the read, so a repeated read of a skipped email records it again instead of failing.

## Consequences

- The database keeps only the emails that the pipeline considers, and the Emails page no longer lists the emails that were skipped or says why.
- A skipped email that a provider delivers again is recorded and deleted again, because its idempotency key is gone with the record. The listener reads from a stored cursor, so this happens only when a read is retried. If a playbook that handles it was enabled in the meantime, the email is then processed.
- Records that were already `not_applicable` from the gate stay until they are deleted. Their reasons, such as `no_active_playbook`, keep their labels.
