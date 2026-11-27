import { playbooks } from "@leren/db";
import type { Db } from "@leren/db";
import type { Embedder } from "@leren/embedder";
import type { VectorFilter, VectorStore } from "@leren/vector-db";
import { and, eq, inArray } from "drizzle-orm";

import { KNOWLEDGE_COLLECTION } from "./indexing";
import type { KnowledgeVectorMetadata } from "./indexing";
import { isKnowledgeUsable } from "./usable";

/** The number of items a search returns at most. */
export const KNOWLEDGE_SEARCH_LIMIT = 5;

/**
 * The cosine similarity below which a vector is not considered a match. Scores depend on the
 * embedding model, so a deployment that changes the model should revisit this value. The value
 * lies between the highest score of an unrelated query and the lowest score of a paraphrased
 * question, as measured with `openai/text-embedding-3-small`.
 */
export const DEFAULT_MIN_SCORE = 0.36;

/**
 * The number of vectors read from the index before validity is applied. It is larger than the
 * result limit so that items which are filtered out do not leave the result short.
 */
const CANDIDATE_LIMIT = 25;

export type KnowledgeSearchDependencies = {
  db: Db;
  store: VectorStore;
  embedder: Embedder;
};

/**
 * What a search is for. `userId` is mandatory, so a search can never read the playbooks of another
 * user. `playbookIds`, when it is a list, limits the search to those playbooks inside the index, so
 * the other playbooks of the user never take a place among the candidates.
 */
export type KnowledgeSearchQuery = {
  userId: string;
  text: string;
  playbookIds?: readonly string[] | null;
};

export type KnowledgeSearchOptions = {
  now?: Date;
  minScore?: number;
  limit?: number;
  signal?: AbortSignal;
};

export type PlaybookRow = typeof playbooks.$inferSelect;

export type KnowledgeMatch = {
  playbook: PlaybookRow;
  score: number;
};

/**
 * The outcome of a search. `no_reliable_result` is an explicit answer that nothing usable is close
 * enough to the query, so a caller can abstain instead of guessing from weak matches.
 */
export type KnowledgeSearchResult =
  | { status: "found"; matches: KnowledgeMatch[] }
  | { status: "no_reliable_result" };

const NO_RELIABLE_RESULT: KnowledgeSearchResult = { status: "no_reliable_result" };

/**
 * Finds the playbooks that are closest in meaning to a text. The index narrows the search
 * to the user and drops vectors below `minScore`. The index is then checked against
 * PostgreSQL, which is the source of truth: only rows that still exist, still belong to the user
 * and satisfy `isKnowledgeUsable` at `now` are returned, with the content of the
 * row and not of the vector. Matches are ordered by descending score.
 */
export async function searchKnowledge(
  { db, store, embedder }: KnowledgeSearchDependencies,
  query: KnowledgeSearchQuery,
  options: KnowledgeSearchOptions = {},
): Promise<KnowledgeSearchResult> {
  const {
    now = new Date(),
    minScore = DEFAULT_MIN_SCORE,
    limit = KNOWLEDGE_SEARCH_LIMIT,
  } = options;

  if (!query.text.trim() || query.playbookIds?.length === 0) {
    return NO_RELIABLE_RESULT;
  }

  await store.ensureCollection({ name: KNOWLEDGE_COLLECTION, dimensions: embedder.dimensions });

  const [vector] = await embedder.embed([query.text], { signal: options.signal });

  const filter: VectorFilter = {
    userId: query.userId,
    type: "knowledge" satisfies KnowledgeVectorMetadata["type"],
  };

  if (query.playbookIds) {
    filter.playbookId = query.playbookIds;
  }

  const candidates = (
    await store.search({
      collection: KNOWLEDGE_COLLECTION,
      vector,
      limit: Math.max(CANDIDATE_LIMIT, limit),
      filter,
    })
  ).filter((candidate) => candidate.score >= minScore);

  if (candidates.length === 0) {
    return NO_RELIABLE_RESULT;
  }

  const rows = await db
    .select()
    .from(playbooks)
    .where(
      and(
        inArray(
          playbooks.id,
          candidates.map((candidate) => candidate.id),
        ),
        eq(playbooks.userId, query.userId),
      ),
    );

  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const matches: KnowledgeMatch[] = [];

  for (const candidate of candidates) {
    const playbook = rowsById.get(candidate.id);

    if (playbook && isKnowledgeUsable(playbook, now)) {
      matches.push({ playbook, score: candidate.score });
    }
  }

  const top = matches.toSorted((a, b) => b.score - a.score).slice(0, limit);

  return top.length > 0 ? { status: "found", matches: top } : NO_RELIABLE_RESULT;
}
