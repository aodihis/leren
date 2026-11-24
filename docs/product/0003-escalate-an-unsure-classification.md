# 0003. An email that cannot be classified reliably is escalated

- Status: Accepted
- Date: 2026-11-24
- Affects: the reply pipeline, packages/reply-agent, prompts/reply-triage.md, docs/overview/risks.md

## Context

The first step of the pipeline decides what an email is and which questions it asks. A wrong answer sends the email to the wrong playbooks. In `send` mode no person reads the reply first, so an unsure classification should not lead to a reply.

## Decision

- Triage reports its confidence in its category and its questions, from 0 to 1.
- An email whose confidence is below 0.6 is escalated to the user with the reason that the classification is not reliable. No playbook is searched and no reply is drafted.
- An answer without a confidence is invalid, so the message is retried and is never answered unchecked.
- The threshold is fixed and is not a user setting.

## Consequences

- More ambiguous emails reach the user, and fewer wrong replies are sent.
- The threshold is a model's own estimate, so it is checked by the evaluation suite and may be tuned.
