import { beforeEach, describe, expect, it } from "vitest";

import { createInMemoryVectorStore } from "./memory";
import type { VectorStore } from "./types";

const COLLECTION = "knowledge";

describe("createInMemoryVectorStore", () => {
  let store: VectorStore;

  beforeEach(async () => {
    store = createInMemoryVectorStore();
    await store.ensureCollection({ name: COLLECTION, dimensions: 2 });
  });

  it("returns results ordered by cosine similarity and applies the limit", async () => {
    await store.upsert(COLLECTION, [
      { id: "a", vector: [1, 0] },
      { id: "b", vector: [1, 1] },
      { id: "c", vector: [0, 1] },
    ]);

    const results = await store.search({ collection: COLLECTION, vector: [1, 0], limit: 2 });

    expect(results.map((result) => result.id)).toEqual(["a", "b"]);
    expect(results[0]?.score).toBeCloseTo(1);
    expect(results[1]?.score).toBeCloseTo(Math.SQRT1_2);
  });

  it("returns only records whose metadata equals every filter entry", async () => {
    await store.upsert(COLLECTION, [
      { id: "a", vector: [1, 0], metadata: { userId: "u1", approved: true } },
      { id: "b", vector: [1, 0], metadata: { userId: "u2", approved: true } },
      { id: "c", vector: [1, 0], metadata: { userId: "u1", approved: false } },
    ]);

    const results = await store.search({
      collection: COLLECTION,
      vector: [1, 0],
      limit: 10,
      filter: { userId: "u1", approved: true },
    });

    expect(results.map((result) => result.id)).toEqual(["a"]);
    expect(results[0]?.metadata).toEqual({ userId: "u1", approved: true });
  });

  it("matches any value of a list filter, and nothing for an empty list", async () => {
    await store.upsert(COLLECTION, [
      { id: "a", vector: [1, 0], metadata: { tag: "x" } },
      { id: "b", vector: [1, 0], metadata: { tag: "y" } },
      { id: "c", vector: [1, 0], metadata: { tag: "z" } },
    ]);

    const search = (tags: string[]) =>
      store.search({ collection: COLLECTION, vector: [1, 0], limit: 10, filter: { tag: tags } });

    expect((await search(["x", "z"])).map((result) => result.id).toSorted()).toEqual(["a", "c"]);
    expect(await search([])).toEqual([]);
  });

  it("treats records without metadata as having empty metadata", async () => {
    await store.upsert(COLLECTION, [{ id: "a", vector: [1, 0] }]);

    const unfiltered = await store.search({ collection: COLLECTION, vector: [1, 0], limit: 10 });

    const filtered = await store.search({
      collection: COLLECTION,
      vector: [1, 0],
      limit: 10,
      filter: { userId: "u1" },
    });

    expect(unfiltered[0]?.metadata).toEqual({});
    expect(filtered).toEqual([]);
  });

  it("replaces a record that is upserted with the same id", async () => {
    await store.upsert(COLLECTION, [{ id: "a", vector: [1, 0], metadata: { version: 1 } }]);
    await store.upsert(COLLECTION, [{ id: "a", vector: [0, 1], metadata: { version: 2 } }]);

    const results = await store.search({ collection: COLLECTION, vector: [0, 1], limit: 10 });

    expect(results).toHaveLength(1);
    expect(results[0]?.metadata).toEqual({ version: 2 });
    expect(results[0]?.score).toBeCloseTo(1);
  });

  it("scores a zero vector as zero similarity", async () => {
    await store.upsert(COLLECTION, [{ id: "a", vector: [0, 0] }]);

    const results = await store.search({ collection: COLLECTION, vector: [1, 0], limit: 10 });

    expect(results[0]?.score).toBe(0);
  });

  it("does not let callers mutate stored records", async () => {
    const vector = [1, 0];
    const metadata = { userId: "u1" };

    await store.upsert(COLLECTION, [{ id: "a", vector, metadata }]);
    vector[0] = 0;
    metadata.userId = "u2";

    const results = await store.search({
      collection: COLLECTION,
      vector: [1, 0],
      limit: 10,
      filter: { userId: "u1" },
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.score).toBeCloseTo(1);
  });

  it("removes deleted records and ignores unknown ids", async () => {
    await store.upsert(COLLECTION, [
      { id: "a", vector: [1, 0] },
      { id: "b", vector: [1, 0] },
    ]);

    await store.delete(COLLECTION, ["a", "missing"]);

    const results = await store.search({ collection: COLLECTION, vector: [1, 0], limit: 10 });

    expect(results.map((result) => result.id)).toEqual(["b"]);
  });

  it("keeps existing records when ensureCollection is called again", async () => {
    await store.upsert(COLLECTION, [{ id: "a", vector: [1, 0] }]);
    await store.ensureCollection({ name: COLLECTION, dimensions: 2 });

    const results = await store.search({ collection: COLLECTION, vector: [1, 0], limit: 10 });

    expect(results).toHaveLength(1);
  });

  it("rejects vectors with the wrong number of dimensions", async () => {
    await expect(store.upsert(COLLECTION, [{ id: "a", vector: [1, 0, 0] }])).rejects.toThrow(
      "Expected a vector with 2 dimensions, received 3",
    );
    await expect(store.search({ collection: COLLECTION, vector: [1], limit: 1 })).rejects.toThrow(
      "Expected a vector with 2 dimensions, received 1",
    );
  });

  it("stores no record of a batch that contains an invalid vector", async () => {
    await expect(
      store.upsert(COLLECTION, [
        { id: "a", vector: [1, 0] },
        { id: "b", vector: [1] },
      ]),
    ).rejects.toThrow();

    const results = await store.search({ collection: COLLECTION, vector: [1, 0], limit: 10 });

    expect(results).toEqual([]);
  });

  it("throws for a collection that does not exist", async () => {
    await expect(store.upsert("missing", [])).rejects.toThrow(
      'Collection "missing" does not exist',
    );
    await expect(store.delete("missing", ["a"])).rejects.toThrow("does not exist");
    await expect(store.search({ collection: "missing", vector: [1, 0], limit: 1 })).rejects.toThrow(
      "does not exist",
    );
  });

  it("removes a deleted collection", async () => {
    await store.deleteCollection(COLLECTION);

    await expect(
      store.search({ collection: COLLECTION, vector: [1, 0], limit: 1 }),
    ).rejects.toThrow("does not exist");
  });

  it("lists the id and metadata of every record", async () => {
    await store.upsert(COLLECTION, [
      { id: "a", vector: [1, 0], metadata: { userId: "u1" } },
      { id: "b", vector: [0, 1] },
    ]);

    expect(await store.list(COLLECTION)).toEqual([
      { id: "a", metadata: { userId: "u1" } },
      { id: "b", metadata: {} },
    ]);
  });
});
