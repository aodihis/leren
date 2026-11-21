import { QdrantClient } from "@qdrant/js-client-rest";

import type { StoredRecord, VectorMetadata, VectorStore } from "./types";

const SCROLL_OPTIONS = { limit: 256, with_payload: true, with_vector: false };

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

    async list(collection) {
      const records: StoredRecord[] = [];
      let page = await client.scroll(collection, SCROLL_OPTIONS);

      while (true) {
        for (const point of page.points) {
          records.push({ id: String(point.id), metadata: (point.payload ?? {}) as VectorMetadata });
        }

        if (page.next_page_offset === null || page.next_page_offset === undefined) {
          return records;
        }

        page = await client.scroll(collection, {
          ...SCROLL_OPTIONS,
          offset: page.next_page_offset,
        });
      }
    },

    async deleteCollection(collection) {
      await client.deleteCollection(collection);
    },
  };
}
