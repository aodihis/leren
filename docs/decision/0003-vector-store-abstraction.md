# 0003. Vector database behind a store abstraction

- Status: Accepted
- Date: 2026-11-19
- Affects: packages/vector-db, docker-compose.yml, docs/rules/packages.md, docs/overview/README.md

## Context

Retrieval-augmented generation needs a vector database. Qdrant is the first choice, but the product may move to another database, such as `pgvector`, later.

## Decision

Add `@leren/vector-db`. It exposes a vendor-neutral `VectorStore` interface and a `createVectorStore({ url })` factory. The factory currently returns a Qdrant-backed store, and that choice is internal to the package. Nothing exported by the package mentions Qdrant, and apps and other packages never import `@qdrant/js-client-rest`. The connection string is read from `VECTOR_STORE_URL`.

Qdrant runs in `docker-compose.yml` on host port 16333 (REST) and 16334 (gRPC). Its built-in dashboard at `http://localhost:16333/dashboard` is the viewer.

## Consequences

- Replacing Qdrant means writing another implementation of `VectorStore` and changing `createVectorStore`. Callers do not change.
- The interface only covers what the product needs: collections, upsert, filtered similarity search and delete. Backend-specific features are not exposed.
- Record ids are UUID strings and metadata values are strings, numbers or booleans, so every backend can support them.
