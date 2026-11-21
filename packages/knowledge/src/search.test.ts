import { autoReplyRules, knowledgeItems, users } from "@leren/db";
import { createTestDatabase } from "@leren/db/testing";
import type { TestDatabase } from "@leren/db/testing";
import { createFakeEmbedder } from "@leren/embedder/testing";
import { createInMemoryVectorStore } from "@leren/vector-db";
import type { VectorStore } from "@leren/vector-db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { KNOWLEDGE_COLLECTION, toEmbeddingText, toVectorMetadata } from "./indexing";
import { measureRecall, recallAtK } from "./recall";
import { searchKnowledge } from "./search";
import type { KnowledgeSearchDependencies } from "./search";

const NOW = new Date("2026-06-15T12:00:00Z");
const PAST = new Date("2026-01-01T00:00:00Z");
const FUTURE = new Date("2026-12-31T00:00:00Z");

describe("knowledge retrieval", () => {
  let database: TestDatabase;
  let store: VectorStore;
  let dependencies: KnowledgeSearchDependencies;
  let userId: string;
  let ruleId: string;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database.drop();
  });

  async function createUser() {
    const [user] = await database.db
      .insert(users)
      .values({ email: `${crypto.randomUUID()}@example.com` })
      .returning({ id: users.id });

    const [rule] = await database.db
      .insert(autoReplyRules)
      .values({ userId: user.id, name: "Holiday", timezone: "UTC" })
      .returning({ id: autoReplyRules.id });

    return { userId: user.id, ruleId: rule.id };
  }

  beforeEach(async () => {
    await database.db.delete(users);

    store = createInMemoryVectorStore();
    dependencies = { db: database.db, store, embedder: createFakeEmbedder() };
    ({ userId, ruleId } = await createUser());
  });

  /**
   * Inserts a row and indexes it the way the worker does, so a test can then change the row or
   * the vector independently.
   */
  async function createIndexedItem(
    values: Partial<typeof knowledgeItems.$inferInsert> = {},
    owner: { userId: string; ruleId: string } = { userId, ruleId },
  ) {
    const [item] = await database.db
      .insert(knowledgeItems)
      .values({
        ...owner,
        topic: "Opening hours",
        response: "We are open from 9 to 5.",
        approvalStatus: "approved",
        ...values,
      })
      .returning();

    await store.ensureCollection({ name: KNOWLEDGE_COLLECTION, dimensions: 64 });
    await store.upsert(KNOWLEDGE_COLLECTION, [
      {
        id: item.id,
        vector: (await dependencies.embedder.embed([toEmbeddingText(item)]))[0],
        metadata: toVectorMetadata(item),
      },
    ]);

    return item;
  }

  function search(text: string, options = {}) {
    return searchKnowledge(dependencies, { userId, ruleId, text }, { now: NOW, ...options });
  }

  it("returns the usable item that matches the query with its score", async () => {
    const item = await createIndexedItem();

    const result = await search("opening hours");

    expect(result).toEqual({
      status: "found",
      matches: [{ item, score: expect.any(Number) }],
    });
  });

  it("ranks matches by descending score and returns at most the top 5", async () => {
    const exact = await createIndexedItem({
      topic: "Parking permit",
      response: "Parking permit.",
    });

    for (let index = 0; index < 6; index += 1) {
      await createIndexedItem({
        topic: `Visitor parking ${index}`,
        response: `Ask reception about parking option ${index} for visitors.`,
      });
    }

    const result = await search("parking permit");

    expect(result.status).toBe("found");

    if (result.status === "found") {
      const scores = result.matches.map((match) => match.score);

      expect(result.matches).toHaveLength(5);
      expect(result.matches[0].item.id).toBe(exact.id);
      expect(scores).toEqual(scores.toSorted((a, b) => b - a));
    }
  });

  it("reports no reliable result when no score reaches the threshold", async () => {
    await createIndexedItem();

    expect(await search("quarterly tax declaration")).toEqual({ status: "no_reliable_result" });
    expect(await search("opening hours", { minScore: 1.01 })).toEqual({
      status: "no_reliable_result",
    });
  });

  it("reports no reliable result for a blank query and for an empty index", async () => {
    expect(await search("   ")).toEqual({ status: "no_reliable_result" });
    expect(await search("opening hours")).toEqual({ status: "no_reliable_result" });
  });

  it("never returns the knowledge of another user", async () => {
    const other = await createUser();

    await createIndexedItem({ topic: "Salary details", response: "Private." }, other);

    expect(await search("salary details")).toEqual({ status: "no_reliable_result" });
  });

  it("does not return an item of another rule of the same user", async () => {
    const [otherRule] = await database.db
      .insert(autoReplyRules)
      .values({ userId, name: "Other", timezone: "UTC" })
      .returning({ id: autoReplyRules.id });

    await createIndexedItem({ topic: "Refunds" }, { userId, ruleId: otherRule.id });

    expect(await search("refunds")).toEqual({ status: "no_reliable_result" });
  });

  it("does not return the row of another user even when its vector claims to be the caller's", async () => {
    const other = await createUser();
    const foreign = await createIndexedItem({ topic: "Salary details" }, other);

    await store.upsert(KNOWLEDGE_COLLECTION, [
      {
        id: foreign.id,
        vector: (await dependencies.embedder.embed([toEmbeddingText(foreign)]))[0],
        metadata: { ...toVectorMetadata(foreign), userId, ruleId },
      },
    ]);

    expect(await search("salary details")).toEqual({ status: "no_reliable_result" });
  });

  describe("usability is decided by PostgreSQL", () => {
    it.each([
      ["a draft item", { approvalStatus: "draft" as const }],
      ["an archived item", { approvalStatus: "archived" as const }],
      ["an expired item", { validUntil: PAST }],
      ["an item that is not valid yet", { validFrom: FUTURE }],
    ])("excludes %s even when its vector is still indexed", async (_name, values) => {
      await createIndexedItem(values);

      expect(await search("opening hours")).toEqual({ status: "no_reliable_result" });
    });

    it("includes an item whose window contains now", async () => {
      await createIndexedItem({ validFrom: PAST, validUntil: FUTURE });

      expect((await search("opening hours")).status).toBe("found");
    });

    it("excludes an item that was archived after it was indexed", async () => {
      const item = await createIndexedItem();

      await database.db
        .update(knowledgeItems)
        .set({ approvalStatus: "archived" })
        .where(eq(knowledgeItems.id, item.id));

      expect(await search("opening hours")).toEqual({ status: "no_reliable_result" });
    });

    it("excludes a vector whose row was deleted", async () => {
      const item = await createIndexedItem();

      await database.db.delete(knowledgeItems).where(eq(knowledgeItems.id, item.id));

      expect(await search("opening hours")).toEqual({ status: "no_reliable_result" });
    });

    it("returns the current content of the row and not the content that was indexed", async () => {
      const item = await createIndexedItem();

      await database.db
        .update(knowledgeItems)
        .set({ response: "We are open from 10 to 6." })
        .where(eq(knowledgeItems.id, item.id));

      const result = await search("opening hours");

      expect(result.status === "found" && result.matches[0].item.response).toBe(
        "We are open from 10 to 6.",
      );
    });

    it("still fills the result when unusable items rank above usable ones", async () => {
      for (let index = 0; index < 8; index += 1) {
        await createIndexedItem({ topic: "Opening hours hours hours", validUntil: PAST });
      }

      const usable = await createIndexedItem({ topic: "Opening hours", response: "Open." });

      const result = await search("opening hours hours hours");

      expect(result.status === "found" && result.matches.map((match) => match.item.id)).toEqual([
        usable.id,
      ]);
    });
  });

  describe("Recall@5", () => {
    it("computes the share of relevant ids among the first k", () => {
      expect(recallAtK(["a", "b"], ["a", "x", "y"], 5)).toBe(0.5);
      expect(recallAtK(["a", "b"], ["x", "y", "a"], 2)).toBe(0);
      expect(recallAtK([], [], 5)).toBe(1);
    });

    it("averages the recall of labelled cases", async () => {
      const hours = await createIndexedItem();
      const parking = await createIndexedItem({ topic: "Parking", response: "Use the garage." });

      const report = await measureRecall(
        dependencies,
        [
          { query: { userId, ruleId, text: "opening hours" }, relevantIds: [hours.id] },
          { query: { userId, ruleId, text: "parking garage" }, relevantIds: [parking.id] },
          { query: { userId, ruleId, text: "tax declaration" }, relevantIds: [hours.id] },
        ],
        { now: NOW },
      );

      expect(report.cases.map((entry) => entry.recall)).toEqual([1, 1, 0]);
      expect(report.recall).toBeCloseTo(2 / 3);
      expect((await measureRecall(dependencies, [])).recall).toBe(1);
    });
  });
});
