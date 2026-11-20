# 0023. Load the harness config in the agent runtime

- Status: Accepted
- Date: 2026-11-20
- Affects: packages/agents, packages/assistant-agent, packages/reply-agent, harness.config.ts, prompts, .env.example, docs/rules/packages.md

## Context

[0011](0011-harness-config-and-plugins.md) defines `harness.config.ts` and the `prompts/` files but leaves the wiring open. The agents still keep their system prompt in `instructions.ts`, and the runners read the model and the key from `OPENAI_*` variables, so the config is not used.

## Decision

- `@leren/agents` exposes `loadHarness`, which finds `harness.config.ts` by walking up from the working directory, or from `HARNESS_CONFIG` when that variable is set, imports it and validates it.
- A loaded `Harness` provides `readPrompt(agent)`, which reads the markdown file of the agent, `createModel(name?)`, which builds the completion model of a configured model, and the absolute `pluginsDir`. `createModel` uses the `defaultModel` when no name is given.
- `createModel` reads the API key from the variable named by `apiKeyEnv` and throws when it is empty. Validation throws when `defaultModel` is not a configured model, or when a default reasoning effort is not one of the supported levels.
- The agent packages take their instructions as an option of `runAgent`. The `instructions.ts` files are removed and `prompts/*.md` is the only copy of a prompt.
- The runners load the harness. The `HARNESS_MODEL` variable selects a configured model other than the default. The `OPENAI_MODEL`, `OPENAI_BASE_URL` and `OPENAI_API` variables are removed, because the config holds those values.
- Plugins stay loaded by `@leren/plugin-client` from `Harness.pluginsDir`. `@leren/agents` does not depend on it.

## Consequences

- Changing a prompt, a model or an endpoint is a change to the config or a markdown file, and not to code.
- The config file is TypeScript, so the process that loads it must run TypeScript, as the runners and the worker do through `tsx`.
- The reasoning effort in the config is validated but not yet passed to the model.
