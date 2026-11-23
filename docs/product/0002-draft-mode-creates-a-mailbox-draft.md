# 0002. A draft reply is created in the user's mailbox

- Status: Accepted
- Date: 2026-11-23
- Affects: playbooks, the reply sender, packages/channels, packages/db, apps/worker, apps/api, docs/overview/README.md, docs/plans/0001-auto-reply-roadmap.md
- Supersedes: [0001](0001-reply-mode-draft-or-send.md)

## Context

[0001](0001-reply-mode-draft-or-send.md) says that in `draft` mode a reply waits in an approval inbox of the product until the user approves, edits or rejects it. The user already has a place to read, edit and send an email, which is their mailbox. An approval inbox of our own would repeat what a mail client does, and it would be a screen that the user has to open next to the one they already use.

## Decision

- Each playbook has a **reply mode** for each channel that it listens on: `draft` or `send`. The default is `draft`.
- In `draft` mode, the reply is created as a draft in the user's own mailbox, in the thread of the email that it answers. The user opens it in their mail client, edits it and sends it, or deletes it. The product does not send a draft and does not wait for the user's approval, and it has no approval screen.
- In `send` mode, a reply is sent as soon as it is produced and no check blocks it. The user does not see it first.
- Only the user chooses the mode, on the Rules tab of the playbook. The assistant cannot change it, and a playbook that the assistant creates is in `draft` mode.
- The agents never send and never create a draft. The reply deliverer in the worker does both, a draft in `draft` mode and a sent reply in `send` mode.
- The mode applies only to messages that a playbook handles. Messages that no playbook handles are never answered.
- A message that the pipeline cannot answer has no draft. The user sees it as escalated in the message log, with the reason.
- The product does not learn what the user does with a draft. A draft that the user sends, changes or deletes in the mail client is not seen by the product.

## Consequences

- There is no approval inbox, and no approve, edit or reject step in the product. The statement of decision 0001 that a draft waits in an inbox of the product no longer holds.
- The mailbox needs the permission to create drafts. A mailbox that was connected before this decision must be connected again.
- A reply in `send` mode still reaches the recipient before the user can correct it, so the interface labels the option as sending without approval.
- The status `drafted` means that a reply is ready. In `draft` mode it means that the draft is in the mailbox. The product cannot tell later that the user sent it.
- A rejected draft is no longer a signal that the product receives, so it cannot become an evaluation case. Failed evaluations and escalated messages remain the sources of new cases.
- Changing the mode of a playbook does not change replies that already exist.
