# 0059. The stored text of an email is redacted after processing

- Status: Accepted
- Date: 2026-11-26
- Affects: packages/inbox, apps/worker, packages/mcp-server, apps/api, docs/overview/README.md

## Context

A received email is stored in `messages` with its subject and body. [0047](0047-telemetry-captures-payloads.md) redacts email addresses and phone numbers in traces, but the table keeps them. The text cannot be redacted when it is saved, because the pipeline reads it to write a reply. The addresses of the sender and the recipients cannot be redacted at all, because the sender allowlist, the recipient rules and the delivery of a reply read them.

## Decision

- The subject and the body of a message are redacted when its processing ends. Email addresses and phone numbers become `[redacted]`. A phone number is recognised by its form, which is a leading `+` and country code, an area code in parentheses, or a local number with a leading zero and separators. This is `redactContactDetails`, which is stricter than the `redact` function of the telemetry, so order numbers, invoice numbers, dates, times and amounts stay readable.
- The redaction happens in the same transaction as the move to `not_applicable`, `escalated`, `sent` or `failed`. A message that is `drafted` keeps its text until the delivery of its reply ends, because the reply subject is built from the original subject. The delivery redacts it when a draft was created.
- The sender, To and Cc addresses are kept. The stored reply and the delivery request, which holds the recipient, are kept.
- The Emails page and the MCP tools `list_messages` and `get_message` show the redacted text.

## Consequences

- Personal contact details in the text of an email do not stay in the database after the email is handled.
- A message that never reaches one of these statuses, such as one stuck in `queued`, keeps its text.
- Rows that were already final before this decision keep their text until a backfill redacts them.
- A phone number or address in the text can no longer be read from the record to understand why a reply was written.
- A phone number written as a bare run of digits, without any of the forms above, is kept, because it cannot be told apart from an order number.
