import { beforeEach, describe, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({
  collectionExists: vi.fn(),
  createCollection: vi.fn(),
  upsert: vi.fn(),
  query: vi.fn(),
  scroll: vi.fn(),
  delete: vi.fn(),
  deleteCollection: vi.fn(),
}));

vi.mock("@qdrant/js-client-rest", () => ({
  QdrantClient: vi.fn(function QdrantClient() {
    return client;
  }),
}));

import { createQdrantStore } from "./qdrant";

describe("createQdrantStore", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("ensureCollection", () => {
    it("creates a cosine collection of the given size when it is missing", async () => {
      client.collectionExists.mockResolvedValue({ exists: false });
      const store = createQdrantStore("http://qdrant");

      await store.ensureCollection({ name: "docs", dimensions: 3 });

      expect(client.createCollection).toHaveBeenCalledExactlyOnceWith("docs", {
        vectors: { size: 3, distance: "Cosine" },
      });
    });

    it("leaves an existing collection untouched", async () => {
      client.collectionExists.mockResolvedValue({ exists: true });
      const store = createQdrantStore("http://qdrant");

      await store.ensureCollection({ name: "docs", dimensions: 3 });

      expect(client.createCollection).not.toHaveBeenCalled();
    });
  });

  describe("upsert", () => {
    it("waits for the write and defaults missing metadata to an empty payload", async () => {
      const store = createQdrantStore("http://qdrant");

      await store.upsert("docs", [
        { id: "a", vector: [1, 0], metadata: { kind: "note" } },
        { id: "b", vector: [0, 1] },
      ]);

      expect(client.upsert).toHaveBeenCalledExactlyOnceWith("docs", {
        wait: true,
        points: [
          { id: "a", vector: [1, 0], payload: { kind: "note" } },
          { id: "b", vector: [0, 1], payload: {} },
        ],
      });
    });
  });

  describe("search", () => {
    it("turns the filter into must-match conditions and maps points to results", async () => {
      client.query.mockResolvedValue({
        points: [
          { id: 7, score: 0.9, payload: { kind: "note" } },
          { id: "b", score: 0.5, payload: null },
        ],
      });
      const store = createQdrantStore("http://qdrant");

      const results = await store.search({
        collection: "docs",
        vector: [1, 0],
        limit: 2,
        filter: { kind: "note", owner: "u1" },
      });

      expect(client.query).toHaveBeenCalledExactlyOnceWith("docs", {
        query: [1, 0],
        limit: 2,
        filter: {
          must: [
            { key: "kind", match: { value: "note" } },
            { key: "owner", match: { value: "u1" } },
          ],
        },
        with_payload: true,
      });
      expect(results).toEqual([
        { id: "7", score: 0.9, metadata: { kind: "note" } },
        { id: "b", score: 0.5, metadata: {} },
      ]);
    });

    it("sends no filter when none is given", async () => {
      client.query.mockResolvedValue({ points: [] });
      const store = createQdrantStore("http://qdrant");

      await store.search({ collection: "docs", vector: [1, 0], limit: 5 });

      expect(client.query).toHaveBeenCalledExactlyOnceWith(
        "docs",
        expect.objectContaining({ filter: undefined }),
      );
    });
  });

  describe("delete", () => {
    it("waits for the points to be removed", async () => {
      const store = createQdrantStore("http://qdrant");

      await store.delete("docs", ["a", "b"]);

      expect(client.delete).toHaveBeenCalledExactlyOnceWith("docs", {
        wait: true,
        points: ["a", "b"],
      });
    });
  });

  describe("list", () => {
    it("follows the offset until every page is read and returns ids with metadata", async () => {
      client.scroll
        .mockResolvedValueOnce({
          points: [{ id: "a", payload: { userId: "u1" } }],
          next_page_offset: "b",
        })
        .mockResolvedValueOnce({ points: [{ id: "b", payload: null }], next_page_offset: null });
      const store = createQdrantStore("http://qdrant");

      const records = await store.list("docs");

      expect(records).toEqual([
        { id: "a", metadata: { userId: "u1" } },
        { id: "b", metadata: {} },
      ]);
      expect(client.scroll).toHaveBeenCalledTimes(2);
      expect(client.scroll).toHaveBeenNthCalledWith(
        2,
        "docs",
        expect.objectContaining({ offset: "b", with_vector: false }),
      );
    });
  });
});
