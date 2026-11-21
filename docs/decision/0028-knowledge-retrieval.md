# 0028. Knowledge retrieval

- Status: Accepted
- Date: 2026-11-21
- Affects: packages/knowledge, docs/rules/packages.md, docs/overview/README.md

## Context

The Reply Agent and the MCP server (decisions 0006 and 0008) need the knowledge items that are closest in meaning to a message. Both run in different apps, so the search cannot live in either of them. The index can lag behind PostgreSQL (decision 0024), and the vector store filters only by equality on payload values.

## Decision

- `@leren/knowledge` exports `searchKnowledge(dependencies, { userId, ruleId, text }, options)`. The user and the rule are mandatory fields of the query, so a search cannot run without them.
- The search embeds the text and asks the vector store for the nearest vectors, filtered by `userId`, `ruleId` and type `knowledge`. It reads more candidates than it returns and drops those below a minimum cosine score, which is `DEFAULT_MIN_SCORE` unless the caller sets one.
- The candidates are then checked against PostgreSQL. A candidate is kept only when its row exists, belongs to the same user and rule, and satisfies `isKnowledgeUsable` at the current time. The returned item is the row, never the payload, so edited content is returned even when the vector is stale.
- The result is `found` with at most five matches ordered by descending score, or `no_reliable_result` when there is no usable match above the threshold. Callers must treat `no_reliable_result` as a reason to abstain.
- `measureRecall` and `recallAtK` score a list of labelled searches as Recall@5. The evaluation suite (roadmap F16) supplies the dataset and the quality gate.

## Consequences

- Approval and validity are enforced even when the index is out of date, at the cost of one extra query per search.
- The threshold depends on the embedding model, so changing the model (decision 0027) requires reviewing `DEFAULT_MIN_SCORE`.
- `@leren/knowledge` now depends on `@leren/db`, `@leren/embedder` and `@leren/vector-db`.
