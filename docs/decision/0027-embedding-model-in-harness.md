# 0027. Embedding models in the harness config

- Status: Accepted
- Date: 2026-11-21
- Affects: harness.config.ts, packages/agents, apps/worker, apps/api, .env.example

## Context

[0024](0024-embedder-and-knowledge-indexing.md) configures the embedding model with `EMBEDDING_BASE_URL`, `EMBEDDING_MODEL` and `EMBEDDING_DIMENSIONS`, while [0025](0025-model-per-task-from-environment.md) selects the chat models by a key of the harness config. Two ways of choosing a model make it harder to see which models the system uses and to change one.

## Decision

- `harness.config.ts` has `embeddingModels`, keyed by a name chosen there, and `defaultEmbeddingModel`. An entry holds the provider, the provider's model id, the key variable `apiKeyEnv`, the endpoint `baseUrl` and the `dimensions` of the vectors.
- `EMBEDDING_MODEL` holds a key of `embeddingModels`. An unset or empty value selects `defaultEmbeddingModel`. `resolveEmbeddingModel` in `@leren/agents` returns the entry and its API key and throws an error that names the variable when either is wrong.
- `EMBEDDING_BASE_URL` and `EMBEDDING_DIMENSIONS` are removed. The API key still comes from the variable named by `apiKeyEnv`, which is `EMBEDDING_API_KEY` for the default entry.
- `ASSISTANT_MODEL` is read by the API and `REPLY_MODEL` by the worker, and both hold a key of `models` (decision 0025). The API and the worker do not use the chat models yet.
- The worker imports `harness.config.ts` from the repository root.

## Consequences

- Every model the system can use is listed in one file, and the environment only chooses among them.
- Decision 0024 describes the variables that this decision replaces. Its other points are unchanged.
- Changing the embedding model or its dimensions still needs a new vector collection.
