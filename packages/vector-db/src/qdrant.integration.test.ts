import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createVectorStore } from "./store";
import type { VectorStore } from "./types";

const QDRANT_URL = process.env.VECTOR_STORE_URL ?? "http://localhost:16333";

/**
 * Runs the `VectorStore` contract against a real Qdrant server from `pnpm services:up`. The unit
 * tests of the adapter replace the Qdrant client, so only this suite proves that the filters, the
 * paging and the id handling work against the real API. Each test uses its own collection.
 */
describe("Qdrant vector store", () => {
  let store: VectorStore;
  let collection: string;

  beforeEach(async () => {
    store = createVectorStore({ url: QDRANT_URL });
    collection = `vector_test_${randomUUID().replaceAll("-", "")}`;

    await store.ensureCollection({ name: collection, dimensions: 2 });
  });

  afterEach(async () => {
    await store.deleteCollection(collection);
  });

  it("accepts writes as soon as ensureCollection returns, even when callers race to create it", async () => {
    for (let round = 0; round < 5; round++) {
      const concurrent = `vector_test_${randomUUID().replaceAll("-", "")}`;

      try {
        await expect(
          Promise.all(
            Array.from({ length: 4 }, async () => {
              await store.ensureCollection({ name: concurrent, dimensions: 2 });
              await store.upsert(concurrent, [{ id: randomUUID(), vector: [1, 0] }]);
            }),
          ),
        ).resolves.toHaveLength(4);
      } finally {
        await store.deleteCollection(concurrent);
      }
    }
  }, 30_000);

  it("returns records ordered by cosine similarity and applies the limit", async () => {
    const [a, b, c] = [randomUUID(), randomUUID(), randomUUID()];

    await store.upsert(collection, [
      { id: a, vector: [1, 0] },
      { id: b, vector: [1, 1] },
      { id: c, vector: [0, 1] },
    ]);

    const results = await store.search({ collection, vector: [1, 0], limit: 2 });

    expect(results.map((result) => result.id)).toEqual([a, b]);
    expect(results[0]?.score).toBeCloseTo(1);
    expect(results[1]?.score).toBeCloseTo(Math.SQRT1_2);
  });

  it("returns only records whose metadata equals every filter entry", async () => {
    const [a, b, c] = [randomUUID(), randomUUID(), randomUUID()];

    await store.upsert(collection, [
      { id: a, vector: [1, 0], metadata: { userId: "u1", approved: true } },
      { id: b, vector: [1, 0], metadata: { userId: "u2", approved: true } },
      { id: c, vector: [1, 0], metadata: { userId: "u1", approved: false } },
    ]);

    const results = await store.search({
      collection,
      vector: [1, 0],
      limit: 10,
      filter: { userId: "u1", approved: true },
    });

    expect(results.map((result) => result.id)).toEqual([a]);
    expect(results[0]?.metadata).toEqual({ userId: "u1", approved: true });
  });

  it("replaces a record that is upserted again under the same id", async () => {
    const id = randomUUID();

    await store.upsert(collection, [{ id, vector: [1, 0], metadata: { version: 1 } }]);
    await store.upsert(collection, [{ id, vector: [0, 1], metadata: { version: 2 } }]);

    expect(await store.list(collection)).toEqual([{ id, metadata: { version: 2 } }]);

    const [result] = await store.search({ collection, vector: [0, 1], limit: 1 });

    expect(result?.score).toBeCloseTo(1);
  });

  it("removes the deleted records and keeps the others", async () => {
    const [keep, remove] = [randomUUID(), randomUUID()];

    await store.upsert(collection, [
      { id: keep, vector: [1, 0] },
      { id: remove, vector: [0, 1] },
    ]);
    await store.delete(collection, [remove]);

    expect((await store.list(collection)).map((record) => record.id)).toEqual([keep]);
  });

  it("lists every record across pages, with its metadata and without its vector", async () => {
    const ids = Array.from({ length: 150 }, () => randomUUID());

    await store.upsert(
      collection,
      ids.map((id, index) => ({ id, vector: [1, index], metadata: { index } })),
    );

    const records = await store.list(collection);

    expect(records.map((record) => record.id).toSorted()).toEqual(ids.toSorted());
    expect(records.every((record) => typeof record.metadata.index === "number")).toBe(true);
  });

  it("keeps the records of a collection that is ensured again", async () => {
    const id = randomUUID();

    await store.upsert(collection, [{ id, vector: [1, 0] }]);
    await store.ensureCollection({ name: collection, dimensions: 2 });

    expect((await store.list(collection)).map((record) => record.id)).toEqual([id]);
  });
});
