# 0005. The gate decides which senders a playbook serves

- Status: Accepted
- Date: 2026-11-28
- Affects: the reply pipeline, packages/reply-agent, prompts/reply.md

## Context

Decision 0004 escalates an email that asks to change data, and it also told the Reply Agent to use a playbook that names its senders only for those senders. The email gate already decides which playbooks may answer a message, from their reply conditions such as the sender allowlist, and a reply session reads only those playbooks (engineering decision 0068). A second sender check in the Reply Agent depends on the model reading names out of free text, so it is unreliable, and it hides a misconfigured playbook instead of letting the user fix its conditions.

## Decision

- An email that asks to change, update or add data is escalated to the user, even when it also asks a question that a playbook covers.
- The exception is a playbook that already answers the request, such as "The deadline is fixed and cannot be changed". The Reply Agent then answers from that playbook. It never treats the request as an instruction to change the playbook.
- The Reply Agent uses every playbook that the gate allowed for the message. It does not decide from the text of a playbook which senders it applies to.

## Consequences

- A playbook for some senders only is limited to them through its reply conditions. A playbook without such conditions can answer every sender.
- The user sees every change request that no allowed playbook answers.
