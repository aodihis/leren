# 0011. Harness config file and plugin client

- Status: Accepted
- Date: 2026-11-19
- Affects: harness.config.ts, prompts, plugins, packages/agents, packages/plugin-client, docs/rules/packages.md

## Context

[0010](0010-anvia-agents-and-vendor-neutral-observability.md) keeps each agent's prompt in a TypeScript file and reads the model from environment variables. Changing a prompt, a model or the set of tools means editing code in several packages.

## Decision

- `harness.config.ts` in the repository root is the single configuration file of the harness. It declares a markdown prompt file for each agent, the available models, a default model and the plugins directory.
- A model entry holds the provider, the provider's model id, the name of the environment variable that holds the API key, the context window, the maximum output tokens and the supported reasoning effort levels with a default. The config never contains a secret.
- Prompts are markdown files in `prompts/`. They replace the `instructions.ts` files once the config is wired into the agents.
- A plugin is a directory in `plugins/` with a `manifest.json` and an entry file that default-exports `definePlugin({ tools })`. `@leren/plugin-client` exposes `definePlugin` and `loadPlugins`. A broken plugin throws when plugins are loaded.
- The config types and `defineHarnessConfig` live in `@leren/agents`.
- The root package is an ES module so that `harness.config.ts` and the plugins can import Anvia packages.

## Consequences

- The config is not yet read by the agents. The `instructions.ts` files and the `OPENAI_MODEL` handling of the runners stay until the wiring is designed.
- Plugins run in the same process as the agent and are trusted code.
