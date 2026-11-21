import type { SearchResult, VectorMetadata, VectorRecord, VectorStore } from "./types";

type Collection = {
  dimensions: number;
  records: Map<string, VectorRecord>;
};

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (const [index, value] of a.entries()) {
    const other = b[index] ?? 0;
    dot += value * other;
    normA += value * value;
    normB += other * other;
  }

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function matchesFilter(metadata: VectorMetadata, filter: VectorMetadata): boolean {
  return Object.entries(filter).every(([key, value]) => metadata[key] === value);
}

/**
 * Creates a `VectorStore` that keeps every collection in memory, for tests.
 *
 * It follows the behavior of the Qdrant store: cosine similarity, exact-match metadata filters,
 * upsert by id, and an error when a collection does not exist. It also rejects vectors whose
 * length differs from the collection's dimensions, as Qdrant does.
 */
export function createInMemoryVectorStore(): VectorStore {
  const collections = new Map<string, Collection>();

  function getCollection(name: string): Collection {
    const collection = collections.get(name);

    if (!collection) {
      throw new Error(`Collection "${name}" does not exist`);
    }

    return collection;
  }

  function assertDimensions(collection: Collection, vector: number[]): void {
    if (vector.length !== collection.dimensions) {
      throw new Error(
        `Expected a vector with ${collection.dimensions} dimensions, received ${vector.length}`,
      );
    }
  }

  return {
    async ensureCollection({ name, dimensions }) {
      if (!collections.has(name)) {
        collections.set(name, { dimensions, records: new Map() });
      }
    },

    async upsert(collectionName, records) {
      const collection = getCollection(collectionName);

      for (const record of records) {
        assertDimensions(collection, record.vector);
      }

      for (const record of records) {
        collection.records.set(record.id, {
          id: record.id,
          vector: [...record.vector],
          metadata: { ...record.metadata },
        });
      }
    },

    async search({ collection: collectionName, vector, limit, filter }) {
      const collection = getCollection(collectionName);

      assertDimensions(collection, vector);

      const results: SearchResult[] = [];

      for (const record of collection.records.values()) {
        const metadata = record.metadata ?? {};

        if (filter && !matchesFilter(metadata, filter)) {
          continue;
        }

        results.push({
          id: record.id,
          score: cosineSimilarity(vector, record.vector),
          metadata: { ...metadata },
        });
      }

      return results.toSorted((a, b) => b.score - a.score).slice(0, limit);
    },

    async delete(collectionName, ids) {
      const collection = getCollection(collectionName);

      for (const id of ids) {
        collection.records.delete(id);
      }
    },

    async list(collectionName) {
      const collection = getCollection(collectionName);

      return [...collection.records.values()].map((record) => ({
        id: record.id,
        metadata: { ...record.metadata },
      }));
    },

    async deleteCollection(collectionName) {
      collections.delete(collectionName);
    },
  };
}
