import { playbooks, users } from "@leren/db";
import { createTestDatabase } from "@leren/db/testing";
import type { TestDatabase } from "@leren/db/testing";
import { createEmbedder } from "@leren/embedder";
import type { Embedder } from "@leren/embedder";
import { createFakeEmbedder } from "@leren/embedder/testing";
import { createVectorStore } from "@leren/vector-db";
import type { VectorStore } from "@leren/vector-db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import harness from "../../../harness.config";
import { KNOWLEDGE_COLLECTION, toEmbeddingText, toVectorMetadata } from "./indexing";
import { measureRecall } from "./recall";
import { searchKnowledge } from "./search";

const NOW = new Date("2026-06-15T12:00:00Z");
const PAST = new Date("2026-01-01T00:00:00Z");
const QDRANT_URL = process.env.VECTOR_STORE_URL ?? "http://localhost:16333";

const embeddingModel = harness.embeddingModels[harness.defaultEmbeddingModel];
const embeddingApiKey = embeddingModel ? process.env[embeddingModel.apiKeyEnv] : undefined;

/**
 * Redirects the knowledge collection of a real store to a collection that only this test run
 * uses, so the tests never read or change the development index.
 */
function isolateCollection(store: VectorStore, name: string): VectorStore {
  const rename = (collection: string) => (collection === KNOWLEDGE_COLLECTION ? name : collection);

  return {
    ensureCollection: (config) => store.ensureCollection({ ...config, name: rename(config.name) }),
    upsert: (collection, records) => store.upsert(rename(collection), records),
    search: (query) => store.search({ ...query, collection: rename(query.collection) }),
    delete: (collection, ids) => store.delete(rename(collection), ids),
    list: (collection) => store.list(rename(collection)),
    deleteCollection: (collection) => store.deleteCollection(rename(collection)),
  };
}

/**
 * Runs the retrieval scenarios against a real Qdrant server and a real PostgreSQL database. The
 * embedder is injected, so the same scenarios cover a deterministic embedder and the real
 * embedding endpoint. The server and the database come from `pnpm services:up`.
 */
function describeRetrieval(name: string, createEmbedderForSuite: () => Embedder, skip = false) {
  describe.skipIf(skip)(name, () => {
    let database: TestDatabase;
    let store: VectorStore;
    let embedder: Embedder;
    let userId: string;

    beforeAll(async () => {
      database = await createTestDatabase();
      embedder = createEmbedderForSuite();
      store = isolateCollection(
        createVectorStore({ url: QDRANT_URL }),
        `knowledge_test_${crypto.randomUUID().replaceAll("-", "")}`,
      );
    });

    afterAll(async () => {
      await store.deleteCollection(KNOWLEDGE_COLLECTION);
      await database.drop();
    });

    async function createOwner() {
      const [user] = await database.db
        .insert(users)
        .values({ email: `${crypto.randomUUID()}@example.com` })
        .returning({ id: users.id });

      return { userId: user.id };
    }

    beforeEach(async () => {
      await database.db.delete(users);
      await store.deleteCollection(KNOWLEDGE_COLLECTION);
      ({ userId } = await createOwner());
    });

    async function createIndexedPlaybook(
      values: Partial<typeof playbooks.$inferInsert>,
      owner: { userId: string } = { userId },
    ) {
      const [playbook] = await database.db
        .insert(playbooks)
        .values({
          ...owner,
          timezone: "UTC",
          topic: "Topic",
          information: "Response.",
          ...values,
        })
        .returning();

      await store.ensureCollection({ name: KNOWLEDGE_COLLECTION, dimensions: embedder.dimensions });
      await store.upsert(KNOWLEDGE_COLLECTION, [
        {
          id: playbook.id,
          vector: (await embedder.embed([toEmbeddingText(playbook)]))[0],
          metadata: toVectorMetadata(playbook),
        },
      ]);

      return playbook;
    }

    function search(text: string, owner = { userId }) {
      return searchKnowledge(
        { db: database.db, store, embedder },
        { ...owner, text },
        { now: NOW },
      );
    }

    it("finds an indexed playbook and returns the row from PostgreSQL", async () => {
      const playbook = await createIndexedPlaybook({
        topic: "Opening hours",
        information: "We are open from 9 to 5.",
      });

      const result = await search("opening hours");

      expect(result).toEqual({
        status: "found",
        matches: [{ playbook, score: expect.any(Number) }],
      });
    });

    it("never returns the knowledge of another user", async () => {
      const other = await createOwner();

      await createIndexedPlaybook({ topic: "Opening hours" }, other);

      expect(await search("opening hours")).toEqual({ status: "no_reliable_result" });
      expect(await search("opening hours", other)).toMatchObject({ status: "found" });
    });

    it("excludes vectors whose row is disabled or expired", async () => {
      await createIndexedPlaybook({ topic: "Opening hours", enabled: false });
      await createIndexedPlaybook({ topic: "Opening hours", endsAt: PAST });

      expect(await search("opening hours")).toEqual({ status: "no_reliable_result" });
    });

    it("reports no reliable result for an unrelated query", async () => {
      await createIndexedPlaybook({
        topic: "Opening hours",
        information: "We are open from 9 to 5.",
      });

      expect(await search("quarterly tax declaration deadline")).toEqual({
        status: "no_reliable_result",
      });
    });

    it("scores a labelled case as Recall@5 of 1", async () => {
      const hours = await createIndexedPlaybook({
        topic: "Opening hours",
        information: "We are open from 9 to 5.",
      });

      const report = await measureRecall(
        { db: database.db, store, embedder },
        [{ query: { userId, text: "opening hours" }, relevantIds: [hours.id] }],
        { now: NOW },
      );

      expect(report.recall).toBe(1);
    });
  });
}

describeRetrieval("knowledge retrieval against Qdrant", () => createFakeEmbedder());

describeRetrieval(
  "knowledge retrieval against Qdrant and the embedding endpoint",
  () =>
    createEmbedder({
      baseUrl: embeddingModel.baseUrl,
      apiKey: embeddingApiKey ?? "",
      model: embeddingModel.modelId,
      dimensions: embeddingModel.dimensions,
    }),
  !embeddingApiKey,
);

describe.skipIf(!embeddingApiKey)("semantic retrieval with the embedding endpoint", () => {
  let database: TestDatabase;
  let store: VectorStore;
  let embedder: Embedder;

  beforeAll(async () => {
    database = await createTestDatabase();
    embedder = createEmbedder({
      baseUrl: embeddingModel.baseUrl,
      apiKey: embeddingApiKey ?? "",
      model: embeddingModel.modelId,
      dimensions: embeddingModel.dimensions,
    });
    store = isolateCollection(
      createVectorStore({ url: QDRANT_URL }),
      `knowledge_test_${crypto.randomUUID().replaceAll("-", "")}`,
    );
  });

  afterAll(async () => {
    await store.deleteCollection(KNOWLEDGE_COLLECTION);
    await database.drop();
  });

  it("ranks the paraphrased question's playbook first and abstains on an unrelated one", async () => {
    const [user] = await database.db
      .insert(users)
      .values({ email: `${crypto.randomUUID()}@example.com` })
      .returning({ id: users.id });

    const owner = { userId: user.id, timezone: "UTC" };

    const rows = await database.db
      .insert(playbooks)
      .values([
        {
          ...owner,
          topic: "Office opening hours",
          information: "The office is open Monday to Friday, 9 to 5.",
        },
        {
          ...owner,
          topic: "Invoice payment terms",
          information: "Invoices are due within 30 days of the invoice date.",
        },
      ])
      .returning();

    await store.ensureCollection({ name: KNOWLEDGE_COLLECTION, dimensions: embedder.dimensions });
    await store.upsert(
      KNOWLEDGE_COLLECTION,
      await Promise.all(
        rows.map(async (playbook) => ({
          id: playbook.id,
          vector: (await embedder.embed([toEmbeddingText(playbook)]))[0],
          metadata: toVectorMetadata(playbook),
        })),
      ),
    );

    const dependencies = { db: database.db, store, embedder };
    const [hours, invoices] = rows;

    const found = await searchKnowledge(
      dependencies,
      { ...owner, text: "What time do you open on weekdays?" },
      { now: NOW },
    );

    expect(found.status === "found" && found.matches[0].playbook.id).toBe(hours.id);

    const report = await measureRecall(
      dependencies,
      [
        {
          query: { ...owner, text: "When is payment due for my invoice?" },
          relevantIds: [invoices.id],
        },
        { query: { ...owner, text: "Are you open on Tuesday morning?" }, relevantIds: [hours.id] },
      ],
      { now: NOW },
    );

    expect(report.recall).toBe(1);

    expect(
      await searchKnowledge(
        dependencies,
        { ...owner, text: "Can you recommend a good pizza restaurant nearby?" },
        { now: NOW },
      ),
    ).toEqual({ status: "no_reliable_result" });

    expect(
      await searchKnowledge(
        dependencies,
        { ...owner, text: "quarterly tax declaration deadline" },
        { now: NOW },
      ),
    ).toEqual({ status: "no_reliable_result" });
  });
});
