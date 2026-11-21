# 0025. Model per task chosen by environment variable

- Status: Accepted
- Date: 2026-11-21
- Affects: harness.config.ts, packages/agents, .env.example

## Context

[0011](0011-harness-config-and-plugins.md) lists the models an agent can run on in `harness.config.ts` and names a single `defaultModel`. [0022](0022-model-endpoint-per-model.md) lets each entry choose its endpoint and wire protocol. Different tasks need different models, and changing one should not mean editing code.

## Decision

- `harness.config.ts` holds the `deepseek-fast` entry. It uses DeepSeek's OpenAI-compatible endpoint with `api: "chat"`, the model id `deepseek-chat` and the key variable `DEEPSEEK_API_KEY`. It is the `defaultModel`.
- Each task has an environment variable whose value is a key of `models`: `ASSISTANT_MODEL` for the Assistant Agent and `REPLY_MODEL` for the Reply Agent. An unset or empty variable selects `defaultModel`.
- `resolveTaskModel` in `@leren/agents` returns the chosen entry and its API key. An unknown key or a missing API key throws an error that names the variable.
- The API key variable stays per model through `apiKeyEnv` (decision 0022).

## Consequences

- Switching a task to another model is a change to one variable, and adding a model is a new entry in the config.
- The runners and the agents do not call `resolveTaskModel` yet. They keep `OPENAI_MODEL` until the config is wired in.
- The embedding model is not a harness model. It stays configured by the `EMBEDDING_*` variables of decision 0024, because the harness entries describe completion models.
