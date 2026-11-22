# 0037. Drop the routing rules feature

- Status: Accepted
- Date: 2026-11-22
- Affects: docs/plans/0001-auto-reply-roadmap.md

## Context

The roadmap planned a routing rules feature (F11): a table of conditions with an action `answer|delegate|ignore|escalate`, a priority, a validity period and a designated contact, a deterministic evaluator and an editor. It was written before [0035](0035-playbooks.md) and [0036](0036-playbooks-enabled-or-disabled.md) merged rules and knowledge into playbooks.

## Decision

- Do not build routing rules as a separate feature.
- `answer` is a playbook. `ignore` is an email that matches no usable playbook or fails its reply conditions, which the gate of the email ingestion feature decides with `evaluateEmailConditions` and `getAutoReplyStatus`.
- `delegate` and `escalate` are outcomes that the Reply Agent chooses from the `contacts` and `restrictions` of the playbooks that retrieval returns, and from the absence of a reliable result.
- If a deterministic override such as "always escalate this sender" is needed later, add an optional action to the reply conditions of a playbook. Do not add a second rule system.

## Consequences

- One concept describes when and how the assistant replies, and there is one editor for it.
- Delegation and escalation depend on the Reply Agent's judgment until an override exists, so the evaluation suite must cover them.
- The roadmap marks F11 as `Dropped` and removes it from the build order.
