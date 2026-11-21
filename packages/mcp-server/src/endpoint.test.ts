import { autoReplyRules, knowledgeItems, knowledgeProposals, mcpAuditLog, users } from "@leren/db";
import { createTestDatabase } from "@leren/db/testing";
import type { TestDatabase } from "@leren/db/testing";
import { createFakeEmbedder } from "@leren/embedder/testing";
import { KNOWLEDGE_COLLECTION, toEmbeddingText, toVectorMetadata } from "@leren/knowledge";
import { createInMemoryVectorStore } from "@leren/vector-db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createMcpEndpoint } from "./handler";
import { mintSession, revokeSession } from "./sessions";
import type { MintSessionInput } from "./sessions";

const SECRET = "a-test-secret-that-is-at-least-32-characters";
const NOW = new Date("2026-06-15T12:00:00Z");
const MISSING_ID = "00000000-0000-4000-8000-000000000000";

type RpcBody = {
  error?: unknown;
  result?: {
    isError?: boolean;
    content?: { text: string }[];
    contents?: { text: string }[];
    messages?: { content: { text: string } }[];
    tools?: { name: string }[];
  };
};

type Reply = { status: number; body: RpcBody | null };

function parsed(result: { data?: string }) {
  return JSON.parse(result.data ?? "null");
}

function toolNames(reply: Reply): string[] {
  return reply.body?.result?.tools?.map((tool) => tool.name) ?? [];
}

describe("MCP endpoint", () => {
  let database: TestDatabase;
  let clock: Date;
  let endpoint: ReturnType<typeof createMcpEndpoint>;
  let store = createInMemoryVectorStore();
  const embedder = createFakeEmbedder();
  let userId: string;
  let ruleId: string;
  let itemId: string;
  let otherUserId: string;
  let otherRuleId: string;
  let otherItemId: string;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await endpoint?.close();
    await database.drop();
  });

  async function seedUser(email: string) {
    const [user] = await database.db.insert(users).values({ email }).returning({ id: users.id });

    const [rule] = await database.db
      .insert(autoReplyRules)
      .values({ userId: user.id, name: `Rule of ${email}`, timezone: "UTC" })
      .returning({ id: autoReplyRules.id });

    const [item] = await database.db
      .insert(knowledgeItems)
      .values({
        userId: user.id,
        ruleId: rule.id,
        topic: "Opening hours",
        response: "We open at nine",
        approvalStatus: "approved",
        approvedAt: NOW,
      })
      .returning();

    await store.ensureCollection({ name: KNOWLEDGE_COLLECTION, dimensions: embedder.dimensions });

    const [vector] = await embedder.embed([toEmbeddingText(item)]);

    await store.upsert(KNOWLEDGE_COLLECTION, [
      { id: item.id, vector, metadata: toVectorMetadata(item) },
    ]);

    return { userId: user.id, ruleId: rule.id, itemId: item.id };
  }

  beforeEach(async () => {
    await database.db.delete(users);

    clock = NOW;
    store = createInMemoryVectorStore();
    endpoint = createMcpEndpoint({
      db: database.db,
      secret: SECRET,
      now: () => clock,
      search: { store, embedder },
    });

    ({ userId, ruleId, itemId } = await seedUser("a@example.com"));
    ({
      userId: otherUserId,
      ruleId: otherRuleId,
      itemId: otherItemId,
    } = await seedUser("b@example.com"));
  });

  async function tokenFor(input: Partial<MintSessionInput> = {}, owner = userId) {
    const minted = await mintSession(
      { db: database.db, secret: SECRET, now: () => clock },
      { userId: owner, role: "assistant", ...input },
    );

    return minted.token;
  }

  async function rpc(token: string | null, method: string, params: object = {}): Promise<Reply> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    };

    if (token) {
      headers.authorization = `Bearer ${token}`;
    }

    const response = await endpoint.fetch(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers,
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      }),
    );

    const text = await response.text();

    const data =
      text.startsWith("event:") || text.includes("\ndata:") ? text.split("data: ")[1] : text;

    return { status: response.status, body: data ? JSON.parse(data) : null };
  }

  async function call(token: string | null, name: string, args: object = {}) {
    const reply = await rpc(token, "tools/call", { name, arguments: args });

    return {
      status: reply.status,
      error: reply.body?.error,
      isError: reply.body?.result?.isError === true,
      data: reply.body?.result?.content?.[0]?.text,
    };
  }

  describe("authentication", () => {
    it.each([
      ["no token", null],
      ["a malformed token", "garbage"],
    ])("rejects %s with 401", async (_label, token) => {
      expect((await rpc(token, "tools/list")).status).toBe(401);
    });

    it("rejects an expired token", async () => {
      const token = await tokenFor({ ttlSeconds: 30 });

      clock = new Date(NOW.getTime() + 31_000);

      expect((await rpc(token, "tools/list")).status).toBe(401);
    });

    it("rejects a token after revocation", async () => {
      const minted = await mintSession(
        { db: database.db, secret: SECRET, now: () => clock },
        { userId, role: "assistant" },
      );

      expect((await rpc(minted.token, "tools/list")).status).toBe(200);

      await revokeSession({ db: database.db, now: () => clock }, userId, minted.sessionId);

      expect((await rpc(minted.token, "tools/list")).status).toBe(401);
    });
  });

  describe("scopes", () => {
    it("lists only the tools the session may use", async () => {
      const full = await rpc(await tokenFor(), "tools/list");

      const restricted = await rpc(
        await tokenFor({ role: "reply", messageId: "m1" }),
        "tools/list",
      );

      expect(toolNames(full)).toContain("propose_knowledge_edit");
      expect(toolNames(restricted)).toEqual(
        expect.arrayContaining([
          "list_rules",
          "get_rule",
          "list_knowledge",
          "get_knowledge",
          "search_knowledge",
        ]),
      );
      expect(toolNames(restricted)).not.toContain("propose_knowledge_edit");
    });

    it("rejects a call to a tool outside the granted scopes", async () => {
      const token = await tokenFor({ scopes: ["rules:read"] });
      const result = await call(token, "get_knowledge", { itemId });

      expect(result.error ?? result.isError).toBeTruthy();
      expect(result.data ?? "").not.toContain("Opening hours");
    });

    it("rejects a proposal from a session without the propose scope", async () => {
      const token = await tokenFor({ role: "reply", messageId: "m1" });

      const result = await call(token, "propose_knowledge_edit", {
        ruleId,
        idempotencyKey: "k",
        topic: "T",
        response: "R",
      });

      expect(result.error ?? result.isError).toBeTruthy();
      expect(await database.db.select().from(knowledgeProposals)).toHaveLength(0);
    });
  });

  describe("read tools", () => {
    it("lists the rules of the session's user only", async () => {
      const result = await call(await tokenFor(), "list_rules");

      expect(parsed(result).rules.map((rule: { id: string }) => rule.id)).toEqual([ruleId]);
    });

    it("gets a rule, and treats another user's rule as missing", async () => {
      const token = await tokenFor();

      expect(parsed(await call(token, "get_rule", { ruleId })).id).toBe(ruleId);

      const foreign = await call(token, "get_rule", { ruleId: otherRuleId });

      expect(foreign.isError).toBe(true);
      expect(foreign.data).toBe("Not found");
    });

    it("rejects invalid input", async () => {
      const result = await call(await tokenFor(), "get_rule", { ruleId: "not-a-uuid" });

      expect(result.error ?? result.isError).toBeTruthy();
    });

    it("lists knowledge of the session's user and filters by status and usability", async () => {
      const token = await tokenFor();

      await database.db
        .insert(knowledgeItems)
        .values({ userId, ruleId, topic: "Draft", response: "r" });

      const all = parsed(await call(token, "list_knowledge"));
      const usable = parsed(await call(token, "list_knowledge", { usableOnly: true }));
      const drafts = parsed(await call(token, "list_knowledge", { status: "draft" }));

      expect(all.items).toHaveLength(2);
      expect(usable.items.map((item: { id: string }) => item.id)).toEqual([itemId]);
      expect(drafts.items.map((item: { topic: string }) => item.topic)).toEqual(["Draft"]);
      expect(all.items.every((item: { id: string }) => item.id !== otherItemId)).toBe(true);
    });

    it("gets a knowledge item, and treats another user's item as missing", async () => {
      const token = await tokenFor();

      expect(parsed(await call(token, "get_knowledge", { itemId })).topic).toBe("Opening hours");
      expect((await call(token, "get_knowledge", { itemId: otherItemId })).isError).toBe(true);
      expect((await call(token, "get_knowledge", { itemId: MISSING_ID })).isError).toBe(true);
    });

    it("searches the user's approved knowledge", async () => {
      const found = parsed(
        await call(await tokenFor(), "search_knowledge", {
          ruleId,
          query: "Opening hours We open at nine",
        }),
      );

      expect(found.status).toBe("found");
      expect(found.matches.map((match: { item: { id: string } }) => match.item.id)).toEqual([
        itemId,
      ]);
    });

    it("does not search the rule of another user", async () => {
      const result = await call(await tokenFor(), "search_knowledge", {
        ruleId: otherRuleId,
        query: "Opening hours",
      });

      expect(result.isError).toBe(true);
      expect(result.data).toBe("Not found");
    });

    it("reports that search is unavailable when it is not configured", async () => {
      endpoint = createMcpEndpoint({ db: database.db, secret: SECRET, now: () => clock });

      const result = await call(await tokenFor(), "search_knowledge", { ruleId, query: "hours" });

      expect(result.isError).toBe(true);
      expect(result.data).toBe("Search is not configured");
    });

    it("reads a knowledge item as a resource and refuses another user's", async () => {
      const token = await tokenFor();
      const own = await rpc(token, "resources/read", { uri: `leren://knowledge/${itemId}` });

      const foreign = await rpc(token, "resources/read", {
        uri: `leren://knowledge/${otherItemId}`,
      });

      expect(JSON.parse(own.body?.result?.contents?.[0]?.text ?? "").id).toBe(itemId);
      expect(foreign.body?.error).toBeDefined();
      expect(JSON.stringify(foreign.body)).not.toContain("Opening hours");
    });

    it("serves the answer prompt", async () => {
      const reply = await rpc(await tokenFor(), "prompts/get", {
        name: "answer_from_knowledge",
        arguments: { ruleId, question: "When do you open?" },
      });

      expect(reply.body?.result?.messages?.[0]?.content.text).toContain("When do you open?");
    });
  });

  describe("propose_knowledge_edit", () => {
    const newItem = { idempotencyKey: "k1", topic: "Parking", response: "Free parking" };

    it("saves a pending proposal and leaves the knowledge unchanged", async () => {
      const result = await call(await tokenFor(), "propose_knowledge_edit", { ruleId, ...newItem });
      const [saved] = await database.db.select().from(knowledgeProposals);

      expect(parsed(result)).toEqual({ proposalId: saved.id, status: "pending" });
      expect(saved).toMatchObject({ userId, ruleId, itemId: null, status: "pending" });
      expect(saved.proposal).toEqual({ topic: "Parking", response: "Free parking" });
      expect(await database.db.select().from(knowledgeItems)).toHaveLength(2);
    });

    it("proposes a change to an existing item", async () => {
      const result = await call(await tokenFor(), "propose_knowledge_edit", {
        ruleId,
        itemId,
        idempotencyKey: "k2",
        response: "We open at ten",
      });

      expect(result.isError).toBe(false);

      const [item] = await database.db
        .select()
        .from(knowledgeItems)
        .where(eq(knowledgeItems.id, itemId));

      expect(item.response).toBe("We open at nine");
    });

    it("returns the first proposal when the idempotency key repeats", async () => {
      const token = await tokenFor();
      const first = parsed(await call(token, "propose_knowledge_edit", { ruleId, ...newItem }));

      const second = parsed(
        await call(token, "propose_knowledge_edit", { ruleId, ...newItem, response: "Other" }),
      );

      expect(second.proposalId).toBe(first.proposalId);
      expect(await database.db.select().from(knowledgeProposals)).toHaveLength(1);
    });

    it("rejects an empty proposal and a new item without a topic and response", async () => {
      const token = await tokenFor();

      const empty = await call(token, "propose_knowledge_edit", {
        ruleId,
        itemId,
        idempotencyKey: "a",
      });

      const partial = await call(token, "propose_knowledge_edit", {
        ruleId,
        idempotencyKey: "b",
        topic: "Only a topic",
      });

      expect(empty.isError).toBe(true);
      expect(partial.isError).toBe(true);
      expect(await database.db.select().from(knowledgeProposals)).toHaveLength(0);
    });

    it("refuses another user's rule and another user's item", async () => {
      const token = await tokenFor();

      const foreignRule = await call(token, "propose_knowledge_edit", {
        ruleId: otherRuleId,
        ...newItem,
      });

      const foreignItem = await call(token, "propose_knowledge_edit", {
        ruleId: otherRuleId,
        itemId: otherItemId,
        idempotencyKey: "x",
        response: "Changed",
      });

      const mismatched = await call(token, "propose_knowledge_edit", {
        ruleId,
        itemId: otherItemId,
        idempotencyKey: "y",
        response: "Changed",
      });

      expect([foreignRule, foreignItem, mismatched].every((result) => result.isError)).toBe(true);
      expect(await database.db.select().from(knowledgeProposals)).toHaveLength(0);
    });

    it("keeps one idempotency key separate between sessions", async () => {
      await call(await tokenFor(), "propose_knowledge_edit", { ruleId, ...newItem });
      await call(await tokenFor(), "propose_knowledge_edit", { ruleId, ...newItem });

      expect(await database.db.select().from(knowledgeProposals)).toHaveLength(2);
    });
  });

  describe("another user's token", () => {
    it("acts only for its own user", async () => {
      const token = await tokenFor({}, otherUserId);
      const list = parsed(await call(token, "list_knowledge"));

      expect(list.items.map((item: { id: string }) => item.id)).toEqual([otherItemId]);
      expect((await call(token, "get_knowledge", { itemId })).isError).toBe(true);
    });
  });

  describe("audit log", () => {
    it("records each call with its outcome and no knowledge text", async () => {
      const token = await tokenFor();

      await call(token, "get_knowledge", { itemId });
      await call(token, "get_knowledge", { itemId: otherItemId });
      await call(token, "propose_knowledge_edit", {
        ruleId,
        idempotencyKey: "k",
        topic: "Secret topic",
        response: "Secret response",
      });

      const rows = await database.db.select().from(mcpAuditLog);

      expect(rows.map((row) => [row.tool, row.outcome]).toSorted()).toEqual([
        ["get_knowledge", "not_found"],
        ["get_knowledge", "ok"],
        ["propose_knowledge_edit", "ok"],
      ]);
      expect(rows.every((row) => row.userId === userId)).toBe(true);
      expect(JSON.stringify(rows)).not.toContain("Secret");
      expect(JSON.stringify(rows)).not.toContain(token);
    });
  });
});
