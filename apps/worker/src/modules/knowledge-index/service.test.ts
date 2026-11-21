import { autoReplyRules, knowledgeItems, users } from "@leren/db";
import { createTestDatabase } from "@leren/db/testing";
import type { TestDatabase } from "@leren/db/testing";
import { createFakeEmbedder } from "@leren/embedder/testing";
import { KNOWLEDGE_COLLECTION } from "@leren/knowledge";
import { createInMemoryVectorStore } from "@leren/vector-db";
import type { VectorStore } from "@leren/vector-db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { checkKnowledgeDrift, repairKnowledgeDrift, syncKnowledgeItem } from "./service";
import type { KnowledgeIndexDependencies } from "./service";

const NOW = new Date("2026-06-15T12:00:00Z");
const PAST = new Date("2026-01-01T00:00:00Z");
const FUTURE = new Date("2026-12-31T00:00:00Z");

describe("knowledge indexing", () => {
  let database: TestDatabase;
  let store: VectorStore;
  let dependencies: KnowledgeIndexDependencies;
  let userId: string;
  let ruleId: string;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database.drop();
  });

  beforeEach(async () => {
    await database.db.delete(users);

    store = createInMemoryVectorStore();
    dependencies = { db: database.db, store, embedder: createFakeEmbedder() };

    [{ id: userId }] = await database.db
      .insert(users)
      .values({ email: `${crypto.randomUUID()}@example.com` })
      .returning({ id: users.id });
    [{ id: ruleId }] = await database.db
      .insert(autoReplyRules)
      .values({ userId, name: "Holiday", timezone: "UTC" })
      .returning({ id: autoReplyRules.id });
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

  async function vectorIds() {
    await store.ensureCollection({ name: KNOWLEDGE_COLLECTION, dimensions: 64 });

    return (await store.list(KNOWLEDGE_COLLECTION)).map((record) => record.id);
  }

  describe("syncKnowledgeItem", () => {
    it("indexes an approved item with its identifiers and window in the payload", async () => {
      const item = await createItem({ validFrom: PAST, validUntil: FUTURE });

      expect(await syncKnowledgeItem(dependencies, item.id, { now: NOW })).toBe("indexed");

      const [record] = await store.list(KNOWLEDGE_COLLECTION);

      expect(record).toEqual({
        id: item.id,
        metadata: {
          knowledgeId: item.id,
          userId,
          ruleId,
          type: "knowledge",
          updatedAt: item.updatedAt.getTime(),
          validFrom: PAST.getTime(),
          validUntil: FUTURE.getTime(),
        },
      });
    });

    it("keeps one vector when the same item is synchronised twice", async () => {
      const item = await createItem();

      await syncKnowledgeItem(dependencies, item.id, { now: NOW });
      await syncKnowledgeItem(dependencies, item.id, { now: NOW });

      expect(await vectorIds()).toEqual([item.id]);
    });

    it("replaces the vector after the item is edited", async () => {
      const item = await createItem();

      await syncKnowledgeItem(dependencies, item.id, { now: NOW });

      const [edited] = await database.db
        .update(knowledgeItems)
        .set({ response: "We are closed on Fridays.", updatedAt: new Date(NOW) })
        .where(eq(knowledgeItems.id, item.id))
        .returning();

      await syncKnowledgeItem(dependencies, item.id, { now: NOW });

      const [record] = await store.list(KNOWLEDGE_COLLECTION);

      expect(record.metadata.updatedAt).toBe(edited.updatedAt.getTime());
    });

    it.each(["draft", "archived"] as const)("removes the vector of a %s item", async (status) => {
      const item = await createItem();

      await syncKnowledgeItem(dependencies, item.id, { now: NOW });
      await database.db
        .update(knowledgeItems)
        .set({ approvalStatus: status })
        .where(eq(knowledgeItems.id, item.id));

      expect(await syncKnowledgeItem(dependencies, item.id, { now: NOW })).toBe("removed");
      expect(await vectorIds()).toEqual([]);
    });

    it("removes the vector of an item whose window has ended", async () => {
      const item = await createItem({ validUntil: PAST });

      await store.ensureCollection({ name: KNOWLEDGE_COLLECTION, dimensions: 64 });
      await store.upsert(KNOWLEDGE_COLLECTION, [{ id: item.id, vector: Array(64).fill(1) }]);

      await syncKnowledgeItem(dependencies, item.id, { now: NOW });

      expect(await vectorIds()).toEqual([]);
    });

    it("removes the vector of a deleted item", async () => {
      const item = await createItem();

      await syncKnowledgeItem(dependencies, item.id, { now: NOW });
      await database.db.delete(knowledgeItems).where(eq(knowledgeItems.id, item.id));

      await syncKnowledgeItem(dependencies, item.id, { now: NOW });

      expect(await vectorIds()).toEqual([]);
    });

    it("does nothing harmful for an id that never existed", async () => {
      expect(await syncKnowledgeItem(dependencies, crypto.randomUUID(), { now: NOW })).toBe(
        "removed",
      );
    });
  });

  describe("checkKnowledgeDrift", () => {
    it("reports no drift when the index matches the database", async () => {
      const item = await createItem();

      await syncKnowledgeItem(dependencies, item.id, { now: NOW });

      expect(await checkKnowledgeDrift(dependencies, NOW)).toEqual({
        missing: [],
        stale: [],
        orphaned: [],
      });
    });

    it("reports an indexable item without a vector as missing", async () => {
      const item = await createItem();

      expect((await checkKnowledgeDrift(dependencies, NOW)).missing).toEqual([item.id]);
    });

    it("reports a vector built from an older version of the row as stale", async () => {
      const item = await createItem();

      await syncKnowledgeItem(dependencies, item.id, { now: NOW });
      await database.db
        .update(knowledgeItems)
        .set({ updatedAt: new Date(item.updatedAt.getTime() + 1000) })
        .where(eq(knowledgeItems.id, item.id));

      expect((await checkKnowledgeDrift(dependencies, NOW)).stale).toEqual([item.id]);
    });

    it("reports vectors without a row, of unapproved items and of expired items as orphaned", async () => {
      const draft = await createItem({ approvalStatus: "draft" });
      const expired = await createItem({ validUntil: PAST });
      const unknown = crypto.randomUUID();

      await store.ensureCollection({ name: KNOWLEDGE_COLLECTION, dimensions: 64 });
      await store.upsert(
        KNOWLEDGE_COLLECTION,
        [draft.id, expired.id, unknown].map((id) => ({ id, vector: Array(64).fill(1) })),
      );

      const { orphaned } = await checkKnowledgeDrift(dependencies, NOW);

      expect(orphaned.toSorted()).toEqual([draft.id, expired.id, unknown].toSorted());
    });
  });

  describe("repairKnowledgeDrift", () => {
    it("leaves every vector referencing an existing indexable row", async () => {
      const kept = await createItem({ topic: "Kept" });
      const missing = await createItem({ topic: "Missing" });
      const edited = await createItem({ topic: "Edited" });
      const archived = await createItem({ topic: "Archived" });
      const deleted = await createItem({ topic: "Deleted" });

      for (const item of [kept, edited, archived, deleted]) {
        await syncKnowledgeItem(dependencies, item.id, { now: NOW });
      }

      await database.db
        .update(knowledgeItems)
        .set({ topic: "Edited again", updatedAt: new Date(NOW) })
        .where(eq(knowledgeItems.id, edited.id));
      await database.db
        .update(knowledgeItems)
        .set({ approvalStatus: "archived" })
        .where(eq(knowledgeItems.id, archived.id));
      await database.db.delete(knowledgeItems).where(eq(knowledgeItems.id, deleted.id));

      const { repaired } = await repairKnowledgeDrift(dependencies, { now: NOW });

      const rows = await database.db.select().from(knowledgeItems);

      const approvedIds = rows
        .filter((row) => row.approvalStatus === "approved")
        .map((row) => row.id);

      expect(repaired).toBe(4);
      expect((await vectorIds()).toSorted()).toEqual(approvedIds.toSorted());
      expect(await vectorIds()).toContain(missing.id);
      expect(await checkKnowledgeDrift(dependencies, NOW)).toEqual({
        missing: [],
        stale: [],
        orphaned: [],
      });
    });
  });
});
