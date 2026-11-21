# 0022. Endpoint and wire protocol per model

- Status: Accepted
- Date: 2026-11-20
- Affects: harness.config.ts, packages/agents, .env.example

## Context

[0011](0011-harness-config-and-plugins.md) describes a model entry by its provider, model id and API key variable. The client always talks to the default OpenAI endpoint with the Responses API. Many providers, such as OpenRouter, expose an OpenAI-compatible endpoint at another URL, and most of them implement the Chat Completions API and not the Responses API.

## Decision

- A model entry has an optional `baseUrl`. When it is omitted, the provider's default endpoint is used.
- A model entry has an optional `api` of `"responses"` or `"chat"`. It defaults to `"responses"`.
- The `openai` provider means an OpenAI-compatible client. The endpoint decides which service answers, so a gateway needs no new provider.
- `baseUrl` is not a secret and may appear in the config. The API key still comes from the variable named by `apiKeyEnv`, and each model may name a different variable.
- `createModel` receives `baseUrl` and `api` together with the key and the model id.

## Consequences

- The same provider client serves OpenAI, OpenRouter and other compatible gateways, selected per model.
- A gateway that supports only Chat Completions needs `api: "chat"`.
- The runners may set `OPENAI_BASE_URL` and `OPENAI_API` to override the endpoint until the config is wired into the agents.
