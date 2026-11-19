import { QdrantClient } from "@qdrant/js-client-rest";

import type { VectorMetadata, VectorStore } from "./types";

/**
 * Creates a `VectorStore` backed by Qdrant, using cosine distance.
 */
export function createQdrantStore(url: string): VectorStore {
  const client = new QdrantClient({ url });

  return {
    async ensureCollection({ name, dimensions }) {
      const { exists } = await client.collectionExists(name);

      if (exists) {
        return;
      }

      await client.createCollection(name, { vectors: { size: dimensions, distance: "Cosine" } });
    },

    async upsert(collection, records) {
      await client.upsert(collection, {
        wait: true,
        points: records.map((record) => ({
          id: record.id,
          vector: record.vector,
          payload: record.metadata ?? {},
        })),
      });
    },

    async search({ collection, vector, limit, filter }) {
      const must = Object.entries(filter ?? {}).map(([key, value]) => ({
        key,
        match: { value },
      }));

      const { points } = await client.query(collection, {
        query: vector,
        limit,
        filter: must.length > 0 ? { must } : undefined,
        with_payload: true,
      });

      return points.map((point) => ({
        id: String(point.id),
        score: point.score,
        metadata: (point.payload ?? {}) as VectorMetadata,
      }));
    },

    async delete(collection, ids) {
      await client.delete(collection, { wait: true, points: ids });
    },

    async deleteCollection(collection) {
      await client.deleteCollection(collection);
    },
  };
}
