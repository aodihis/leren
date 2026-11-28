import { randomUUID } from "node:crypto";

import { playbooks, users } from "@leren/db";
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
 * Runs the indexing pipeline from the message to the search result against the real RabbitMQ,
 * Qdrant and PostgreSQL services from `pnpm services:up`. Queue and collection names are unique to
 * the run, so a development worker never takes its messages.
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

  async function createPlaybook(values: Partial<typeof playbooks.$inferInsert> = {}) {
    const [playbook] = await database.db
      .insert(playbooks)
      .values({
        userId,
        timezone: "UTC",
        topic: "Opening hours",
        information: "We are open from 9 to 5.",
        ...values,
      })
      .returning();

    return playbook;
  }

  async function requestIndex(playbookId: string): Promise<void> {
    const message: KnowledgeIndexMessage = { playbookId };

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
    return searchKnowledge(dependencies, { userId, text });
  }

  it("makes an enabled playbook searchable once its message is consumed", async () => {
    const playbook = await createPlaybook();

    await requestIndex(playbook.id);
    await waitFor(async () => (await indexedIds()).includes(playbook.id));

    expect(await search("opening hours")).toMatchObject({
      status: "found",
      matches: [{ playbook: { id: playbook.id } }],
    });
  });

  it("stops returning a playbook after it is disabled and its message is consumed", async () => {
    const playbook = await createPlaybook();

    await requestIndex(playbook.id);
    await waitFor(async () => (await indexedIds()).includes(playbook.id));

    await database.db
      .update(playbooks)
      .set({ enabled: false })
      .where(eq(playbooks.id, playbook.id));
    await requestIndex(playbook.id);
    await waitFor(async () => !(await indexedIds()).includes(playbook.id));

    expect(await search("opening hours")).toEqual({ status: "no_reliable_result" });
  });

  it("repairs a missing vector and removes an orphaned one when the drift message is consumed", async () => {
    const missing = await createPlaybook({ topic: "Parking" });
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
