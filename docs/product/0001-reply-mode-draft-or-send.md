# 0001. A playbook saves replies as drafts or sends them

- Status: Superseded
- Date: 2026-11-22
- Affects: playbooks, the approval inbox, packages/db, apps/api, apps/worker, apps/platform, docs/overview/README.md, docs/plans/0001-auto-reply-roadmap.md
- Superseded by: [0002](0002-draft-mode-creates-a-mailbox-draft.md)

## Context

The first version of the product only created drafts, and a person approved every reply before it was sent. A user whose playbook answers a narrow, low-risk topic, such as opening hours, gains little from approving each reply. The same user may want other playbooks to keep the approval step.

## Decision

- Each playbook has a **reply mode** for each channel that it listens on: `draft` or `send`. The default is `draft`.
- In `draft` mode, a reply is saved as a draft and waits in the approval inbox until the user approves, edits or rejects it. Nothing is sent before the user approves it.
- In `send` mode, a reply is sent as soon as it is produced and no check blocks it. The user does not see it first.
- Only the user chooses the mode, on the Rules tab of the playbook. The assistant cannot change it, and a playbook that the assistant creates is in `draft` mode.
- The agents never send. The reply sender sends in both modes, after approval in `draft` mode and without it in `send` mode.
- The mode applies only to messages that a playbook handles. Messages that no playbook handles are never answered.

## Consequences

- The statement that a person approves every reply no longer holds for a playbook in `send` mode. The overview and the roadmap say that the default is a draft and that `send` is the user's choice.
- A mistake in a playbook in `send` mode reaches the sender before the user can correct it, so the interface labels the option as sending without approval.
- The setting is stored from now on, and it takes effect when sending is built. Until then every reply is a draft.
- Changing the mode of a playbook does not change replies that already exist.
