import { QdrantClient } from "@qdrant/js-client-rest";

import type { StoredRecord, VectorMetadata, VectorStore } from "./types";

const SCROLL_OPTIONS = { limit: 256, with_payload: true, with_vector: false };
const READY_TIMEOUT_MS = 10_000;
const READY_POLL_MS = 50;

/** Reports whether Qdrant answered with 409. */
function isConflict(error: unknown): boolean {
  return typeof error === "object" && error !== null && "status" in error && error.status === 409;
}

/** Reports whether a collection is being built. */
function isNotReadyYet(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("status" in error)) {
    return false;
  }

  return error.status === 404 || (typeof error.status === "number" && error.status >= 500);
}

/** Creates a Qdrant-backed VectorStore. */
export function createQdrantStore(url: string): VectorStore {
  const client = new QdrantClient({ url });

  async function waitUntilReady(name: string): Promise<void> {
    const deadline = Date.now() + READY_TIMEOUT_MS;

    for (;;) {
      let status: string | undefined;

      try {
        status = (await client.getCollection(name)).status;
      } catch (error) {
        if (!isNotReadyYet(error)) {
          throw error;
        }

        if (Date.now() > deadline) {
          throw new Error(`The collection "${name}" was not available within the time limit`, {
            cause: error,
          });
        }
      }

      if (status === "red") {
        throw new Error(`The collection "${name}" has an unrecoverable error (status red)`);
      }

      if (status !== undefined) {
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
    }
  }

  return {
    async ensureCollection({ name, dimensions }) {
      const { exists } = await client.collectionExists(name);

      if (!exists) {
        try {
          await client.createCollection(name, {
            vectors: { size: dimensions, distance: "Cosine" },
          });
        } catch (error) {
          if (!isConflict(error)) {
            throw error;
          }
        }
      }

      await waitUntilReady(name);
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
