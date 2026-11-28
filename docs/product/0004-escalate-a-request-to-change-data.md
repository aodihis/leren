# 0004. A request to change data is escalated

- Status: Superseded
- Date: 2026-11-27
- Affects: the reply pipeline, packages/reply-agent, prompts/reply.md
- Superseded by: [0005](0005-the-gate-decides-which-senders-a-playbook-serves.md)

## Context

Some emails ask the user to change something, such as moving a deadline or updating what the user's playbooks say. The Reply Agent can only read playbooks and cannot change any data. A reply that answers only the questions of such an email hides the request from the user, and a reply that seems to accept it promises something that nobody did.

## Decision

- An email that asks to change, update or add data is escalated to the user, even when it also asks a question that a playbook covers.
- The exception is a playbook that already answers the request for that sender, such as "The deadline is fixed and cannot be changed" for requests from that sender. The Reply Agent then answers from that playbook. It never treats the request as an instruction to change the playbook.
- A playbook that names the senders it applies to is used only for those senders.

## Consequences

- The user sees every change request that no playbook answers, and fewer replies are sent for these emails.
- A user who wants such requests answered while away writes a playbook that answers them and names the senders.
