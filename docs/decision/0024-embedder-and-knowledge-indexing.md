# 0024. Embedder and knowledge indexing

- Status: Accepted
- Date: 2026-11-20
- Affects: packages/embedder, packages/knowledge, packages/vector-db, apps/api, apps/worker, .env.example, docs/rules/packages.md, docs/overview/README.md

## Context

Retrieval finds knowledge by similarity, so every knowledge item that the assistant may use needs a vector in Qdrant (decision 0003). PostgreSQL stays the source of truth (decision 0020). The index must follow the item when it is approved, edited, archived, deleted or when its validity window ends, and it must be possible to prove that the two stores agree.

## Decision

- Add `@leren/embedder` with the vendor-neutral `Embedder` interface: `dimensions` and `embed(texts, { signal })`. The package ships an implementation for any OpenAI-compatible `/embeddings` endpoint and, in `@leren/embedder/testing`, a deterministic fake that needs no network.
- The default provider is OpenAI's `text-embedding-3-small` with 1536 dimensions, reached through OpenRouter as `openai/text-embedding-3-small`. The endpoint, key, model and dimensions come from `EMBEDDING_BASE_URL`, `EMBEDDING_API_KEY`, `EMBEDDING_MODEL` and `EMBEDDING_DIMENSIONS`, so another compatible gateway needs no code change.
- An item has exactly one vector in the `knowledge` collection, and the vector id is the item id. A vector therefore always names its PostgreSQL row, and indexing the same item twice overwrites the same point.
- The embedded text is the topic, the response and the examples (decision 0020). The payload holds the item id, user id, rule id, type `knowledge`, `validFrom` and `validUntil` as epoch milliseconds (a missing bound is omitted), and `updatedAt` as epoch milliseconds. `updatedAt` identifies the version of the row that the vector was built from.
- An item is indexed when it is approved and its window has not ended. This is `isKnowledgeIndexable` in `@leren/knowledge`. An item whose window has not started yet is indexed, because its payload carries the window and retrieval filters with `isKnowledgeUsable`'s rule.
- The API publishes a message with the item id to the `knowledge.index` queue after it creates, edits, approves, archives, restores or deletes an item. A failed publish is logged and does not fail the request.
- The `knowledge.index` consumer in the worker ignores what the message says happened. It reads the current row and makes the index match it: it upserts the vector when the item is indexable and deletes the vector otherwise, including when the row no longer exists. A repeated or reordered message therefore converges on the same state.
- A drift check lists the vectors in Qdrant and compares them with the rows in PostgreSQL. It reports a vector as `orphaned` when its row is missing or not indexable, a row as `missing` when it is indexable and has no vector, and a vector as `stale` when its `updatedAt` differs from the row's. The `knowledge.drift` job runs the check and repairs every difference with the same synchronisation as the consumer. The worker enqueues this job periodically, which also removes the vectors of items whose window has ended.
- `VectorStore` gains `list(collection)`, which returns the id and metadata of every record.

## Consequences

- Replacing the embedding provider means setting four variables, or writing another `Embedder`. Changing the model or its dimensions requires a new collection, because Qdrant fixes the vector size.
- An item is not searchable until the worker has processed its message, and expired items can stay in the index until the next drift run. Retrieval must still filter by validity and approval, and it does not trust the index alone.
- Because the message carries only an id, a lost or duplicated message cannot leave stale content behind. The drift check is the safety net for a publish that failed after the database change.
- `list` reads the whole collection, which is acceptable for the size of one user's knowledge and is run periodically, not per request.
