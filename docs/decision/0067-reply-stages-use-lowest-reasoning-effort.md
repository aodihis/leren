# 0067. The reply stages run a reasoning model at its lowest reasoning effort

- Status: Superseded
- Date: 2026-11-27
- Affects: packages/reply-agent, packages/agents, harness.config.ts
- Superseded by: [0069](0069-reasoning-effort-from-the-harness-config.md)

## Context

Decision [0066](0066-answer-agent-and-style-step.md) limits the output tokens of every model call of the reply pipeline: 600 for triage, 1500 for each turn of the answering agent, 1200 for the style stage and 800 for each judge. A reasoning model, such as `gpt-5`, counts its reasoning against that limit. At the provider's default effort its reasoning can use the whole limit, so the answer is cut off and treated as unreadable. Decision [0030](0030-wire-the-harness-config.md) validates the reasoning effort of the harness config but does not pass it to the model.

## Decision

- Every stage of the reply pipeline sends the lowest reasoning effort that the model accepts. The model adapter declares the efforts of a reasoning model from the lowest to the highest, and the pipeline takes the first one. For `gpt-5` and `gpt-5-mini` it is `minimal`.
- A model that declares no reasoning effort gets no effort, and its calls do not change.
- `createAgent` in `@leren/agents` passes the model controls through, so the answering agent sends the effort on each turn.
- The `defaultReasoningEffort` of the harness config does not apply to the reply pipeline.

## Consequences

- A reasoning model can be chosen for a reply task without most of its answers being cut off. At the lowest effort an answer can still be cut off, which is treated as unreadable as before.
- The lowest effort may lower the quality of the answers and of the judges' verdicts. The reply pipeline has no evals yet, so this is not measured.
- This decision is provisional. When the rebuilt reply evals show that the answers are not good enough, the token limits of decision 0066 or the effort of this decision are to be revisited, for example by removing the limits for reasoning models, in a new decision.
