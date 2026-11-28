# 0069. Every model call uses a reasoning effort from the harness config

- Status: Accepted
- Date: 2026-11-28
- Affects: packages/agents, packages/reply-agent, apps/worker, harness.config.ts

## Context

Decision [0067](0067-reply-stages-use-lowest-reasoning-effort.md) runs every reply stage at the lowest reasoning effort that the model's adapter declares. The OpenAI adapter declares efforts only for OpenAI model names, and the core refuses a control that a model does not declare. The gateway models in the harness config listed no efforts, so they declared none and reasoned at the provider's default. For triage, `deepseek-v4-flash` wrote 155 to 477 reasoning tokens for an answer of about 50 tokens, took 4 to 12 seconds, and was cut off at its token limit on some emails. The efforts and default efforts that the config listed for the OpenAI models did not reach the model either.

The gateway accepts `reasoning_effort` for `deepseek-v4-flash`, `glm-5.3` and `gpt-6-luna`. `gpt-6-luna` rejects `"minimal"`. `glm-5.3` stops reasoning at `"minimal"` and `"low"`. DeepSeek's own API thinks by default at the `high` effort, accepts `low`, `high` and `max` for `reasoning_effort`, and maps `minimal` to `low` and `medium` to `high`. Only `thinking: { type: "disabled" }` turns its thinking off, so `deepseek-v4-flash` keeps reasoning at its lowest effort.

## Decision

- Every model of the harness config that reasons lists the efforts it accepts and its default effort. The harness refuses a config in which a model lists efforts without a default.
- `harness.model(key, reasoning?)` builds a model by its key, declaring the efforts of its config entry, and returns the controls to call it with: `reasoning` when the model lists it, and otherwise the model's default. A model is never asked for an effort that it does not list, and a model without efforts gets no effort. `harness.createModel(task)` builds the same model for the task's key.
- `generateJson` takes the key of a model and an optional reasoning effort. The reply pipeline receives the keys of its models, and the worker resolves them from the task variables, such as `REPLY_TRIAGE_MODEL`.
- Triage asks for `minimal`. The answering agent, the style stage and the judges run at the default effort of their model.
- The judges have no output token limit, so that their reasoning cannot cut off a verdict. This replaces the judge limit of decision [0066](0066-answer-agent-and-style-step.md). The limits of triage, of each turn of the answering agent and of the style stage stay.

## Consequences

- The reasoning effort of a model is changed in the harness config, not in code. A higher default makes the answering agent and the style stage reason more within their token limits, so a default must leave room for their answers.
- A triage model that does not list `minimal`, such as `gpt-6-luna`, runs at its default, and a model without efforts gets none, so no provider is sent an effort that it rejects.
- A judge call can write as many tokens as the model allows, which costs more when a judge reasons at length.
