import { knowledgeItems } from "@leren/db";
import type { Db } from "@leren/db";
import type { Embedder } from "@leren/embedder";
import {
  KNOWLEDGE_COLLECTION,
  isKnowledgeIndexable,
  toEmbeddingText,
  toVectorMetadata,
} from "@leren/knowledge";
import type { KnowledgeVectorMetadata } from "@leren/knowledge";
import type { VectorStore } from "@leren/vector-db";
import { eq } from "drizzle-orm";

export type KnowledgeIndexDependencies = {
  db: Db;
  store: VectorStore;
  embedder: Embedder;
};

export type SyncOutcome = "indexed" | "removed";

/**
 * The differences between PostgreSQL and the vector index. `missing` lists indexable items with
 * no vector, `stale` lists vectors built from an older version of their row, and `orphaned` lists
 * vectors whose row is missing or no longer indexable.
 */
export type KnowledgeDrift = {
  missing: string[];
  stale: string[];
  orphaned: string[];
};

export type DriftRepair = {
  drift: KnowledgeDrift;
  repaired: number;
};

/**
 * Makes the vector index match the current state of one item. The vector id is the item id, so an
 * item has at most one vector. An indexable item is embedded and upserted, and any other state,
 * including a deleted row, removes the vector. The function reads the row and never trusts a
 * message about what changed, so running it again or out of order leaves the same result.
 */
export async function syncKnowledgeItem(
  { db, store, embedder }: KnowledgeIndexDependencies,
  itemId: string,
  options: { now?: Date; signal?: AbortSignal } = {},
): Promise<SyncOutcome> {
  const now = options.now ?? new Date();

  await store.ensureCollection({ name: KNOWLEDGE_COLLECTION, dimensions: embedder.dimensions });

  const [item] = await db.select().from(knowledgeItems).where(eq(knowledgeItems.id, itemId));

  if (!item || !isKnowledgeIndexable(item, now)) {
    await store.delete(KNOWLEDGE_COLLECTION, [itemId]);

    return "removed";
  }

  const [vector] = await embedder.embed([toEmbeddingText(item)], { signal: options.signal });

  await store.upsert(KNOWLEDGE_COLLECTION, [
    { id: item.id, vector, metadata: toVectorMetadata(item) },
  ]);

  return "indexed";
}

/**
 * Compares every approved item with every vector. Only approved items can be indexable, so the
 * query reads those rows and any vector outside that set is orphaned. A stale vector is one whose
 * stored `updatedAt` differs from the row's.
 */
export async function checkKnowledgeDrift(
  { db, store, embedder }: KnowledgeIndexDependencies,
  now = new Date(),
): Promise<KnowledgeDrift> {
  await store.ensureCollection({ name: KNOWLEDGE_COLLECTION, dimensions: embedder.dimensions });

  const [approved, vectors] = await Promise.all([
    db.select().from(knowledgeItems).where(eq(knowledgeItems.approvalStatus, "approved")),
    store.list(KNOWLEDGE_COLLECTION),
  ]);

  const expected = new Map(
    approved
      .filter((item) => isKnowledgeIndexable(item, now))
      .map((item) => [item.id, item.updatedAt.getTime()]),
  );

  const drift: KnowledgeDrift = { missing: [], stale: [], orphaned: [] };
  const indexed = new Set<string>();

  for (const vector of vectors) {
    const updatedAt = expected.get(vector.id);
    const stored = (vector.metadata as Partial<KnowledgeVectorMetadata>).updatedAt;

    indexed.add(vector.id);

    if (updatedAt === undefined) {
      drift.orphaned.push(vector.id);
    } else if (stored !== updatedAt) {
      drift.stale.push(vector.id);
    }
  }

  drift.missing = [...expected.keys()].filter((id) => !indexed.has(id));

  return drift;
}

/**
 * Finds the drift and repairs every difference by synchronising the affected items one by one. An
 * item that cannot be synchronised makes the call throw, so the job is retried and the remaining
 * differences are handled on the next attempt.
 */
export async function repairKnowledgeDrift(
  dependencies: KnowledgeIndexDependencies,
  options: { now?: Date; signal?: AbortSignal } = {},
): Promise<DriftRepair> {
  const drift = await checkKnowledgeDrift(dependencies, options.now);
  const ids = [...drift.missing, ...drift.stale, ...drift.orphaned];

  for (const id of ids) {
    await syncKnowledgeItem(dependencies, id, options);
  }

  return { drift, repaired: ids.length };
}
