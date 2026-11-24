import { playbooks, users } from "@leren/db";
import { createTestDatabase } from "@leren/db/testing";
import type { TestDatabase } from "@leren/db/testing";
import { createFakeEmbedder } from "@leren/embedder/testing";
import { KNOWLEDGE_COLLECTION } from "@leren/knowledge";
import { createInMemoryVectorStore } from "@leren/vector-db";
import type { VectorStore } from "@leren/vector-db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { checkKnowledgeDrift, repairKnowledgeDrift, syncPlaybook } from "./service";
import type { KnowledgeIndexDependencies } from "./service";

const NOW = new Date("2026-06-15T12:00:00Z");
const PAST = new Date("2026-01-01T00:00:00Z");
const FUTURE = new Date("2026-12-31T00:00:00Z");

describe("knowledge indexing", () => {
  let database: TestDatabase;
  let store: VectorStore;
  let dependencies: KnowledgeIndexDependencies;
  let userId: string;

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

  async function vectorIds() {
    await store.ensureCollection({ name: KNOWLEDGE_COLLECTION, dimensions: 64 });

    return (await store.list(KNOWLEDGE_COLLECTION)).map((record) => record.id);
  }

  describe("syncPlaybook", () => {
    it("indexes an enabled playbook with its identifiers and period in the payload", async () => {
      const playbook = await createPlaybook({ startsAt: PAST, endsAt: FUTURE });

      expect(await syncPlaybook(dependencies, playbook.id, { now: NOW })).toBe("indexed");

      const [record] = await store.list(KNOWLEDGE_COLLECTION);

      expect(record).toEqual({
        id: playbook.id,
        metadata: {
          playbookId: playbook.id,
          userId,
          type: "knowledge",
          updatedAt: playbook.updatedAt.getTime(),
          startsAt: PAST.getTime(),
          endsAt: FUTURE.getTime(),
        },
      });
    });

    it("keeps one vector when the same playbook is synchronised twice", async () => {
      const playbook = await createPlaybook();

      await syncPlaybook(dependencies, playbook.id, { now: NOW });
      await syncPlaybook(dependencies, playbook.id, { now: NOW });

      expect(await vectorIds()).toEqual([playbook.id]);
    });

    it("replaces the vector after the playbook is edited", async () => {
      const playbook = await createPlaybook();

      await syncPlaybook(dependencies, playbook.id, { now: NOW });

      const [edited] = await database.db
        .update(playbooks)
        .set({ information: "We are closed on Fridays.", updatedAt: new Date(NOW) })
        .where(eq(playbooks.id, playbook.id))
        .returning();

      await syncPlaybook(dependencies, playbook.id, { now: NOW });

      const [record] = await store.list(KNOWLEDGE_COLLECTION);

      expect(record.metadata.updatedAt).toBe(edited.updatedAt.getTime());
    });

    it("removes the vector of a disabled playbook", async () => {
      const playbook = await createPlaybook();

      await syncPlaybook(dependencies, playbook.id, { now: NOW });
      await database.db
        .update(playbooks)
        .set({ enabled: false })
        .where(eq(playbooks.id, playbook.id));

      expect(await syncPlaybook(dependencies, playbook.id, { now: NOW })).toBe("removed");
      expect(await vectorIds()).toEqual([]);
    });

    it("removes the vector of a playbook whose period has ended", async () => {
      const playbook = await createPlaybook({ endsAt: PAST });

      await store.ensureCollection({ name: KNOWLEDGE_COLLECTION, dimensions: 64 });
      await store.upsert(KNOWLEDGE_COLLECTION, [{ id: playbook.id, vector: Array(64).fill(1) }]);

      await syncPlaybook(dependencies, playbook.id, { now: NOW });

      expect(await vectorIds()).toEqual([]);
    });

    it("removes the vector of a deleted playbook", async () => {
      const playbook = await createPlaybook();

      await syncPlaybook(dependencies, playbook.id, { now: NOW });
      await database.db.delete(playbooks).where(eq(playbooks.id, playbook.id));

      await syncPlaybook(dependencies, playbook.id, { now: NOW });

      expect(await vectorIds()).toEqual([]);
    });

    it("does nothing harmful for an id that never existed", async () => {
      expect(await syncPlaybook(dependencies, crypto.randomUUID(), { now: NOW })).toBe("removed");
    });
  });

  describe("checkKnowledgeDrift", () => {
    it("reports no drift when the index matches the database", async () => {
      const playbook = await createPlaybook();

      await syncPlaybook(dependencies, playbook.id, { now: NOW });

      expect(await checkKnowledgeDrift(dependencies, NOW)).toEqual({
        missing: [],
        stale: [],
        orphaned: [],
      });
    });

    it("reports an indexable playbook without a vector as missing", async () => {
      const playbook = await createPlaybook();

      expect((await checkKnowledgeDrift(dependencies, NOW)).missing).toEqual([playbook.id]);
    });

    it("reports a vector built from an older version of the row as stale", async () => {
      const playbook = await createPlaybook();

      await syncPlaybook(dependencies, playbook.id, { now: NOW });
      await database.db
        .update(playbooks)
        .set({ updatedAt: new Date(playbook.updatedAt.getTime() + 1000) })
        .where(eq(playbooks.id, playbook.id));

      expect((await checkKnowledgeDrift(dependencies, NOW)).stale).toEqual([playbook.id]);
    });

    it("reports vectors without a row, of unenabled playbooks and of expired playbooks as orphaned", async () => {
      const draft = await createPlaybook({ enabled: false });
      const expired = await createPlaybook({ endsAt: PAST });
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
      const kept = await createPlaybook({ topic: "Kept" });
      const missing = await createPlaybook({ topic: "Missing" });
      const edited = await createPlaybook({ topic: "Edited" });
      const archived = await createPlaybook({ topic: "Archived" });
      const deleted = await createPlaybook({ topic: "Deleted" });

      for (const playbook of [kept, edited, archived, deleted]) {
        await syncPlaybook(dependencies, playbook.id, { now: NOW });
      }

      await database.db
        .update(playbooks)
        .set({ topic: "Edited again", updatedAt: new Date(NOW) })
        .where(eq(playbooks.id, edited.id));
      await database.db
        .update(playbooks)
        .set({ enabled: false })
        .where(eq(playbooks.id, archived.id));
      await database.db.delete(playbooks).where(eq(playbooks.id, deleted.id));

      const { repaired } = await repairKnowledgeDrift(dependencies, { now: NOW });

      const rows = await database.db.select().from(playbooks);

      const enabledIds = rows.filter((row) => row.enabled).map((row) => row.id);

      expect(repaired).toBe(4);
      expect((await vectorIds()).toSorted()).toEqual(enabledIds.toSorted());
      expect(await vectorIds()).toContain(missing.id);
      expect(await checkKnowledgeDrift(dependencies, NOW)).toEqual({
        missing: [],
        stale: [],
        orphaned: [],
      });
    });
  });
});
