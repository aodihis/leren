import { randomUUID } from "node:crypto";

import { autoReplyRules, knowledgeItems, users } from "@leren/db";
import { createTestDatabase } from "@leren/db/testing";
import type { TestDatabase } from "@leren/db/testing";
import { createFakeEmbedder } from "@leren/embedder/testing";
import { KNOWLEDGE_COLLECTION, searchKnowledge } from "@leren/knowledge";
import type { KnowledgeIndexMessage } from "@leren/knowledge";
import { createRabbitMqQueue } from "@leren/queue";
import type { QueueClient } from "@leren/queue";
import { createVectorStore } from "@leren/vector-db";
import type { VectorStore } from "@leren/vector-db";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { Worker } from "../../worker";
import { createKnowledgeDriftJob, createKnowledgeIndexJob } from "./job";
import type { KnowledgeIndexDependencies } from "./service";

const RABBITMQ_URL = process.env.RABBITMQ_URL ?? "amqp://leren:leren@localhost:56720";
const QDRANT_URL = process.env.VECTOR_STORE_URL ?? "http://localhost:16333";

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

async function waitFor(condition: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 10_000;

  while (!(await condition())) {
    if (Date.now() > deadline) {
      throw new Error("Timed out waiting for the condition");
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/**
 * Runs the indexing pipeline from the message to the search result against a real RabbitMQ
 * broker, a real Qdrant server and a real PostgreSQL database from `pnpm services:up`. The jobs
 * consume queues with unique names, so a worker running for development never takes their
 * messages, and the vectors go to a collection that only this run uses.
 */
describe("knowledge indexing pipeline", () => {
  let database: TestDatabase;
  let store: VectorStore;
  let queue: QueueClient;
  let worker: Worker;
  let dependencies: KnowledgeIndexDependencies;
  let indexQueue: string;
  let driftQueue: string;
  let userId: string;
  let ruleId: string;

  beforeAll(async () => {
    database = await createTestDatabase();
    queue = await createRabbitMqQueue({ url: RABBITMQ_URL });
    store = isolateCollection(
      createVectorStore({ url: QDRANT_URL }),
      `knowledge_test_${randomUUID().replaceAll("-", "")}`,
    );
    dependencies = { db: database.db, store, embedder: createFakeEmbedder() };
  });

  afterAll(async () => {
    await queue.close();
    await store.deleteCollection(KNOWLEDGE_COLLECTION);
    await database.drop();
  });

  beforeEach(async () => {
    await database.db.delete(users);
    await store.deleteCollection(KNOWLEDGE_COLLECTION);

    [{ id: userId }] = await database.db
      .insert(users)
      .values({ email: `${randomUUID()}@example.com` })
      .returning({ id: users.id });
    [{ id: ruleId }] = await database.db
      .insert(autoReplyRules)
      .values({ userId, name: "Holiday", timezone: "UTC" })
      .returning({ id: autoReplyRules.id });

    indexQueue = `knowledge.index.test.${randomUUID()}`;
    driftQueue = `knowledge.drift.test.${randomUUID()}`;
    worker = new Worker({
      queue,
      jobs: [
        { ...createKnowledgeIndexJob(dependencies), name: indexQueue },
        { ...createKnowledgeDriftJob(dependencies), name: driftQueue },
      ],
    });
    await worker.start();
  });

  afterEach(async () => {
    await worker?.stop();
  });

  async function createItem(values: Partial<typeof knowledgeItems.$inferInsert> = {}) {
    const [item] = await database.db
      .insert(knowledgeItems)
      .values({
        userId,
        ruleId,
        topic: "Opening hours",
        response: "We are open from 9 to 5.",
        approvalStatus: "approved",
        ...values,
      })
      .returning();

    return item;
  }

  async function requestIndex(itemId: string): Promise<void> {
    const message: KnowledgeIndexMessage = { itemId };

    await queue.publish(indexQueue, message);
  }

  async function indexedIds(): Promise<string[]> {
    await store.ensureCollection({
      name: KNOWLEDGE_COLLECTION,
      dimensions: dependencies.embedder.dimensions,
    });

    return (await store.list(KNOWLEDGE_COLLECTION)).map((record) => record.id);
  }

  function search(text: string) {
    return searchKnowledge(dependencies, { userId, ruleId, text });
  }

  it("makes an approved item searchable once its message is consumed", async () => {
    const item = await createItem();

    await requestIndex(item.id);
    await waitFor(async () => (await indexedIds()).includes(item.id));

    expect(await search("opening hours")).toMatchObject({
      status: "found",
      matches: [{ item: { id: item.id } }],
    });
  });

  it("stops returning an item after it is archived and its message is consumed", async () => {
    const item = await createItem();

    await requestIndex(item.id);
    await waitFor(async () => (await indexedIds()).includes(item.id));

    await database.db
      .update(knowledgeItems)
      .set({ approvalStatus: "archived" })
      .where(eq(knowledgeItems.id, item.id));
    await requestIndex(item.id);
    await waitFor(async () => !(await indexedIds()).includes(item.id));

    expect(await search("opening hours")).toEqual({ status: "no_reliable_result" });
  });

  it("repairs a missing vector and removes an orphaned one when the drift message is consumed", async () => {
    const missing = await createItem({ topic: "Parking" });
    const orphan = randomUUID();

    await store.ensureCollection({
      name: KNOWLEDGE_COLLECTION,
      dimensions: dependencies.embedder.dimensions,
    });
    await store.upsert(KNOWLEDGE_COLLECTION, [
      { id: orphan, vector: (await dependencies.embedder.embed(["ghost"]))[0] },
    ]);

    await queue.publish(driftQueue, {});
    await waitFor(async () => {
      const ids = await indexedIds();

      return ids.includes(missing.id) && !ids.includes(orphan);
    });

    expect(await indexedIds()).toEqual([missing.id]);
  });
});
