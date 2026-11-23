# 0043. Reply decisions, the escalated status and the `email.process` consumer

- Status: Accepted
- Date: 2026-11-23
- Affects: packages/db, packages/inbox, apps/worker, apps/api, docs/overview/README.md, docs/plans/0001-auto-reply-roadmap.md

## Context

[0042](0042-reply-agent-pipeline.md) defines a pipeline that ends in `answer`, `delegate`, `escalate` or `ignore`, and leaves the saving of its result and the status of the message to its caller. [0039](0039-email-record-reply-mode-and-gate.md) lists the statuses of a message and says that a later decision adds a status when a stage needs one, such as an escalation. A message that the pipeline hands back to the user has no draft and is not failed, so no existing status describes it. The approval stage must also have a stored draft to show.

## Decision

- A new status `escalated` means that the pipeline decided that the user must handle the message, and `statusReason` says why. `processing` may move to `escalated`, and `escalated` is final.
- A new table `reply_decisions` holds the result of the pipeline, one row for each message. It holds the owner, the message, the outcome, the body, the ids of the cited playbooks, the reasons, the category of the email, the number of revisions, the ids of the playbooks that were used and the evaluations of the drafts. The body is the draft when the outcome is `answer` or `delegate`, and it is empty otherwise. A message has at most one row, so saving a result twice changes nothing. Deleting the message or the user deletes the row.
- The worker consumes `email.process` with a job that works as follows:
  - It ends the work, and acknowledges, when the message is gone or is not `queued` or `processing`, so a repeated delivery changes nothing.
  - It moves the message to `processing`, opens the MCP session of decision 0042 for the owner of the record, runs the pipeline and closes the session when the run ends.
  - It uses only the playbooks that the gate named in the job. A playbook that retrieval or the agent finds, and that the job does not name, is dropped, because the gate decided which playbooks reply on the account of this message.
  - It runs the mention check when every playbook of the job has the verdict `check_mention`. A message that one playbook handles outright needs no mention check.
  - It saves the decision, then moves the message: `answer` and `delegate` to `drafted`, `escalate` to `escalated`, and `ignore` to `not_applicable` with the reason `not_addressed`. The save and the move are separate statements, and each is safe to repeat, so a job that stopped between them finishes on its next delivery.
  - A job that fails is retried. On its last attempt it moves the message to `failed` with the reason `pipeline_error` and then reports the failure, so the message ends in the dead-letter queue and the user can see it. A job whose message or playbooks do not belong together does not retry.
- Sending is not part of this decision. `drafted` is the end of the work of this job in both reply modes, and the approval and sending feature reads the decision and sets the later statuses.
- The worker creates one observer for the process, passes it to the pipeline, flushes it after each message and closes it when the process shuts down. It needs `MCP_SESSION_SECRET` and `MCP_URL`. When the models or the prompt of the reply pipeline cannot be loaded, the worker logs a warning and does not consume `email.process`, so the messages wait in the queue and the rest of the worker keeps running.
- The API accepts `escalated` as a value of the `status` filter of `GET /api/messages`.

## Consequences

- The user can see in the message log which emails need them, and why.
- A change of reply mode applies at the approval and sending stage, which reads the stored decision.
- The decisions are the source of the cases for the evaluation suite: a rejected draft and an escalation can be turned into a case.
- A message that stays `processing` after a crash is picked up again by the next delivery. A message whose last attempt fails is `failed` and is visible.
- Reply instructions are not stored yet, so the pipeline runs without them until their feature exists.
