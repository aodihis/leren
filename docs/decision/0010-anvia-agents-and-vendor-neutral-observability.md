# 0010. Anvia for agents, behind a vendor-neutral observer

- Status: Accepted
- Date: 2026-11-19
- Affects: packages/agents, packages/assistant-agent, packages/reply-agent, packages/observability, .env.example, docs/rules/packages.md

## Context

[0006](0006-two-agents-ui-first.md) chose Anvia as the agent framework. Agents need a model provider, an MCP client and tracing. Tracing backends change more often than the agent framework, and the applications should not need to change when one is replaced.

## Decision

- `packages/agents` is the shared agent runtime. It depends on `@anvia/core`, `@anvia/openai` and `@anvia/mcp` and exposes `createAgent`, `createModel` and `connectMcp`. It knows nothing about a specific agent.
- Each agent is its own package: `packages/assistant-agent` and `packages/reply-agent`. A package owns its id, turn limit, MCP tool allow-list, prompt and, later, its evaluation suite, and exposes `runAgent(options)`. The Assistant Agent streams its events and is limited to 75 turns. The Reply Agent runs inside a pipeline, returns its final answer and is limited to 5 turns, as decided in [0006](0006-two-agents-ui-first.md). The two agents are evaluated separately, so neither package depends on the other. The allow-list is a client-side filter in addition to the scopes the MCP server enforces.
- Test doubles for agents are in `@leren/agents/testing`, which holds a scripted fake model.
- `packages/observability` exposes a vendor-neutral `Observer` and `createObserver`. Applications and other packages never import a tracing backend. The Anvia Lens implementation is private to the package.
- `createObserver` returns a no-op observer when the Lens connection variables (`ANVIA_LENS_*`) are not set. A partial configuration throws at startup. The package makes this decision, not the apps.
- Lens runs in the safe capture mode, so prompt and response bodies are not exported.
- Lens is hosted outside this repository, so the repository does not add it to `docker-compose.yml`.

## Consequences

- The two agent packages are excluded from coverage for the same reason as `packages/agents` in [0009](0009-vitest-for-unit-tests.md): agents are evaluated with evals.
- Replacing Lens with another backend means adding one implementation of `Observer` and changing `createObserver`.
- `Observer.forAgent()` returns Anvia's observability options. This ties the interface to Anvia as the agent framework, but not to a tracing backend.
- Agent tool names in each agent's configuration must match the tools the MCP server defines in F09.
