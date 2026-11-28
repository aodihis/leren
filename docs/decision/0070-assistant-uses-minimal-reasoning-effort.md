# 0070. The Assistant Agent runs at the minimal reasoning effort

- Status: Accepted
- Date: 2026-11-28
- Affects: packages/agents, packages/assistant-agent, apps/api

## Context

Decision [0069](0069-reasoning-effort-from-the-harness-config.md) gives every model call a reasoning effort from the harness config through `harness.model`. The Assistant Agent built its model with `harness.createModel("assistant")`, which returns the model without its controls, so the chat sent no reasoning effort and reasoned at the provider's default. A chat answer waits for that reasoning on every turn.

## Decision

- `harness.taskModel(task, reasoning?)` builds the model that a task's environment variable selects, together with its controls, by the rules of `harness.model`.
- The Assistant Agent asks for `minimal`. The API, the runner, the studio and the evals build its model with `taskModel("assistant", "minimal")` and pass the controls to the agent.

## Consequences

- The chat reasons as little as its model allows, so its answers start sooner and cost less, and a hard question may be answered less carefully.
- A model that does not list `minimal`, such as `gpt-6-luna`, runs at its default effort, and a model without efforts gets none.
- The assistant evals measure the effort that the product uses.
