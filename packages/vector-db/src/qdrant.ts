import { QdrantClient } from "@qdrant/js-client-rest";

import type { StoredRecord, VectorMetadata, VectorStore } from "./types";

const SCROLL_OPTIONS = { limit: 256, with_payload: true, with_vector: false };
const READY_TIMEOUT_MS = 10_000;
const READY_POLL_MS = 50;

/**
 * Reports whether Qdrant rejected a request with HTTP 409, which it answers when a collection
 * already exists. Concurrent callers of `ensureCollection` can both observe a missing collection,
 * so the loser of the creation race receives this status and the collection it wanted exists.
 */
function isConflict(error: unknown): boolean {
  return typeof error === "object" && error !== null && "status" in error && error.status === 409;
}

/**
 * Reports whether Qdrant answered with an HTTP status that a collection under construction
 * produces: 404 before its creation is visible and 500 while its replicas start.
 */
function isNotReadyYet(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("status" in error)) {
    return false;
  }

  return error.status === 404 || (typeof error.status === "number" && error.status >= 500);
}

/**
 * Creates a `VectorStore` backed by Qdrant, using cosine distance.
 *
 * `ensureCollection` returns once Qdrant can describe the collection. A collection that another
 * caller is still creating already exists for `collectionExists` and for a conflicting create, but
 * Qdrant answers requests for it with HTTP 404 or 500 until its creation completes. Afterwards
 * every status except `red` accepts writes: `yellow` means the collection is optimizing and `grey`
 * means optimizations are pending after a restart, and only a write restarts them.
 */
export function createQdrantStore(url: string, apiKey?: string): VectorStore {
  const client = new QdrantClient({ url, apiKey });

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
        match: Array.isArray(value) ? { any: [...value] } : { value },
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
