# 0048. The dashboard counts and the playbook report are computed when they are read

- Status: Accepted
- Date: 2026-11-23
- Affects: apps/api, apps/platform, docs/overview/README.md, docs/plans/0001-auto-reply-roadmap.md

## Context

The user needs to see what the assistant did across all emails, and what a playbook did during its period. The message records and the reply decisions already hold every fact for that (decisions 0039, 0043 and 0046). A stored counter or a stored report would repeat those facts and could disagree with them.

## Decision

- A new API module, `dashboard`, serves two read-only routes under `/api/dashboard`. Both require a session and every query is scoped by the session's user.
- `GET /api/dashboard/overview` takes `days` (1 to 365, default 30) and returns the counts of the messages received in that window, grouped by status, by outcome and by delivery state, and the most recent failures. A failure is a message with the status `failed` or a decision whose delivery state is `failed`. The counts are computed by the database on each request.
- `GET /api/dashboard/playbooks/:id/report` returns the report of one playbook. It answers `404` when the user has no such playbook and `409` with the error `period_not_ended` when the playbook has no end or its end is still in the future. The report counts the decisions that used the playbook (`reply_decisions.playbook_ids`) for messages received between the start and the end of its period, grouped by outcome and by delivery state, and the number of decisions that cite it in the reply. It is computed when it is read and is never stored.
- The communication log is the Processed emails list. It gains an `outcome` filter next to the status filter, and the overview links to the failures in it.

## Consequences

- A count is always consistent with the records, and a report for a period that has ended gives the same numbers every time it is read, except when records are later removed.
- Each read scans the user's messages inside the window. The `messages_user_received_idx` index bounds the scan, which is acceptable for the volume of one user's mailbox. A later decision can add a stored summary if that stops being true.
- The report only covers a playbook that has an end. A playbook without a period has no report.
