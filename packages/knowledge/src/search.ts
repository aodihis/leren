import { playbooks } from "@leren/db";
import type { Db } from "@leren/db";
import type { Embedder } from "@leren/embedder";
import type { VectorStore } from "@leren/vector-db";
import { and, eq, inArray } from "drizzle-orm";

import { KNOWLEDGE_COLLECTION } from "./indexing";
import type { KnowledgeVectorMetadata } from "./indexing";
import { isKnowledgeUsable } from "./usable";

/** The number of items a search returns at most. */
export const KNOWLEDGE_SEARCH_LIMIT = 5;

/** The cosine similarity threshold for a match. */
export const DEFAULT_MIN_SCORE = 0.36;

/** The number of vectors read before filtering. */
const CANDIDATE_LIMIT = 25;

export type KnowledgeSearchDependencies = {
  db: Db;
  store: VectorStore;
  embedder: Embedder;
};

/** What a search is for. */
export type KnowledgeSearchQuery = {
  userId: string;
  text: string;
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

/** The outcome of a search. */
export type KnowledgeSearchResult =
  | { status: "found"; matches: KnowledgeMatch[] }
  | { status: "no_reliable_result" };

const NO_RELIABLE_RESULT: KnowledgeSearchResult = { status: "no_reliable_result" };

/** Finds the playbooks closest in meaning to a text. */
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

  if (!query.text.trim()) {
    return NO_RELIABLE_RESULT;
  }

  await store.ensureCollection({ name: KNOWLEDGE_COLLECTION, dimensions: embedder.dimensions });

  const [vector] = await embedder.embed([query.text], { signal: options.signal });

  const filter: Pick<KnowledgeVectorMetadata, "userId" | "type"> = {
    userId: query.userId,
    type: "knowledge",
  };

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
