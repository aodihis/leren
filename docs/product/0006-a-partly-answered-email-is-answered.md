# 0006. A partly answered email is answered, and the questions left out are recorded

- Status: Accepted
- Date: 2026-11-28
- Affects: the reply pipeline, packages/reply-agent, prompts/reply-judge.md, docs/overview/README.md

## Context

An email can ask several questions, and the playbooks may cover only some of them. The Reply Agent answers the covered questions and does not promise a later answer, a follow-up or any other step that no playbook and no default reply instruction gives. The content judge, as engineering decision 0042 first described it, passed coverage only when every question was answered or explicitly deferred. The two rules contradicted each other, so every partly answered email used up its revisions and was escalated. The user was also not told which question a reply left out.

## Decision

- An email that the playbooks cover in part is answered. The reply answers the covered questions and leaves the others out, without a deferral that no playbook or default reply instruction gives.
- The content judge passes coverage when every question that a playbook covers is answered. A question that no playbook covers does not make coverage fail.
- The questions that a reply leaves out are recorded with the decision of the message, so that the user sees what the sender was not told.
- This applies in both reply modes, `draft` and `send`.
- An email that no playbook covers at all is still escalated.

## Consequences

- The sender gets an answer to what the playbooks cover instead of no reply until the user steps in.
- The user can follow up on the questions that a reply left out, from the reasons of its decision.
- A default reply instruction that gives a follow-up sentence, such as when the user will reply, is used for the questions left out.
