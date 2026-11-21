import { autoReplyRules, knowledgeItems, mcpAuditLog, users } from "@leren/db";
import { createTestDatabase } from "@leren/db/testing";
import type { TestDatabase } from "@leren/db/testing";
import { createFakeEmbedder } from "@leren/embedder/testing";
import { KNOWLEDGE_COLLECTION, toEmbeddingText, toVectorMetadata } from "@leren/knowledge";
import { createInMemoryVectorStore } from "@leren/vector-db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createMcpEndpoint } from "./handler";
import { mintSession, revokeSession } from "./sessions";
import type { MintSessionInput } from "./sessions";
import type { McpWriteAction, McpWriteActions, McpWriteOutcome } from "./tools";

const SECRET = "a-test-secret-that-is-at-least-32-characters";
const NOW = new Date("2026-06-15T12:00:00Z");
const MISSING_ID = "00000000-0000-4000-8000-000000000000";

const NEW_ID = "11111111-1111-4111-8111-111111111111";

/**
 * A write action that saves nothing and records how it was called, so these tests cover the
 * endpoint's scopes, user binding and audit and not the business rules of the API.
 */
function stubAction(
  fields: z.ZodRawShape,
  outcome: McpWriteOutcome = { status: "saved", id: NEW_ID, data: { id: NEW_ID } },
) {
  const run = vi.fn(async (_userId: string, _input: never): Promise<McpWriteOutcome> => outcome);
  const action: McpWriteAction = { description: "A stub", inputSchema: z.object(fields), run };

  return { action, run };
}

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
  let actions: McpWriteActions;
  let createKnowledge: ReturnType<typeof stubAction>;

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
    createKnowledge = stubAction({ ruleId: z.uuid(), topic: z.string(), response: z.string() });

    actions = {
      createRule: stubAction({ name: z.string() }).action,
      updateRule: stubAction({ ruleId: z.uuid() }).action,
      createKnowledge: createKnowledge.action,
      updateKnowledge: stubAction({ itemId: z.uuid() }).action,
    };

    endpoint = createMcpEndpoint({
      db: database.db,
      secret: SECRET,
      now: () => clock,
      search: { store, embedder },
      actions,
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

      expect(toolNames(full)).toEqual(
        expect.arrayContaining([
          "create_rule",
          "update_rule",
          "create_knowledge",
          "update_knowledge",
        ]),
      );
      expect(toolNames(restricted)).toEqual(
        expect.arrayContaining([
          "list_rules",
          "get_rule",
          "list_knowledge",
          "get_knowledge",
          "search_knowledge",
        ]),
      );
      expect(toolNames(restricted)).not.toContain("create_knowledge");
      expect(toolNames(restricted)).not.toContain("create_rule");
    });

    it("rejects a call to a tool outside the granted scopes", async () => {
      const token = await tokenFor({ scopes: ["rules:read"] });
      const result = await call(token, "get_knowledge", { itemId });

      expect(result.error ?? result.isError).toBeTruthy();
      expect(result.data ?? "").not.toContain("Opening hours");
    });

    it("rejects a write from a session without the write scope", async () => {
      const token = await tokenFor({ role: "reply", messageId: "m1" });

      const result = await call(token, "create_knowledge", { ruleId, topic: "T", response: "R" });

      expect(result.error ?? result.isError).toBeTruthy();
      expect(createKnowledge.run).not.toHaveBeenCalled();
    });

    it("grants rule writes and knowledge writes separately", async () => {
      const knowledgeOnly = toolNames(
        await rpc(await tokenFor({ scopes: ["knowledge:write"] }), "tools/list"),
      );

      expect(knowledgeOnly).toEqual(["create_knowledge", "update_knowledge"]);
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

  describe("write tools", () => {
    const newItem = { topic: "Parking", response: "Free parking" };

    it("runs the action for the session's user and returns its result", async () => {
      const result = await call(await tokenFor(), "create_knowledge", { ruleId, ...newItem });

      expect(createKnowledge.run).toHaveBeenCalledWith(userId, { ruleId, ...newItem });
      expect(parsed(result)).toEqual({ id: NEW_ID });
    });

    it("binds the call to the token's user and not to any argument", async () => {
      await call(await tokenFor({}, otherUserId), "create_knowledge", {
        ruleId: otherRuleId,
        ...newItem,
        userId,
      });

      expect(createKnowledge.run.mock.calls[0]?.[0]).toBe(otherUserId);
    });

    it("rejects arguments that fail validation without running the action", async () => {
      const result = await call(await tokenFor(), "create_knowledge", { ruleId: "no" });

      expect(result.error ?? result.isError).toBeTruthy();
      expect(createKnowledge.run).not.toHaveBeenCalled();
    });

    it("reports an invalid change and an unknown id as errors", async () => {
      const invalid = stubAction(
        { ruleId: z.uuid() },
        { status: "invalid", message: "Enter a topic" },
      );

      const missing = stubAction({ itemId: z.uuid() }, { status: "not_found" });

      endpoint = createMcpEndpoint({
        db: database.db,
        secret: SECRET,
        now: () => clock,
        actions: { ...actions, createRule: invalid.action, updateKnowledge: missing.action },
      });

      const token = await tokenFor();
      const first = await call(token, "create_rule", { ruleId });
      const second = await call(token, "update_knowledge", { itemId: MISSING_ID });

      expect(first).toMatchObject({ isError: true, data: "Enter a topic" });
      expect(second).toMatchObject({ isError: true, data: "Not found" });
    });

    it("does not register the write tools without actions", async () => {
      endpoint = createMcpEndpoint({ db: database.db, secret: SECRET, now: () => clock });

      expect(toolNames(await rpc(await tokenFor(), "tools/list"))).not.toContain("create_rule");
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
    it("records calls rejected before a tool body runs, without their arguments", async () => {
      const limited = await tokenFor({ scopes: ["rules:read"] });

      await call(limited, "get_knowledge", { itemId });
      await call(await tokenFor(), "get_rule", { ruleId: "not-a-uuid" });

      const rows = await database.db.select().from(mcpAuditLog);

      expect(rows.map((row) => [row.tool, row.outcome]).toSorted()).toEqual([
        ["get_knowledge", "rejected"],
        ["get_rule", "rejected"],
      ]);
      expect(rows.every((row) => Object.keys(row.summary).length === 0)).toBe(true);
    });

    it("records each call with its outcome and no knowledge text", async () => {
      const token = await tokenFor();

      await call(token, "get_knowledge", { itemId });
      await call(token, "get_knowledge", { itemId: otherItemId });
      await call(token, "create_knowledge", {
        ruleId,
        topic: "Secret topic",
        response: "Secret response",
      });

      const rows = await database.db.select().from(mcpAuditLog);

      expect(rows.map((row) => [row.tool, row.outcome]).toSorted()).toEqual([
        ["create_knowledge", "ok"],
        ["get_knowledge", "not_found"],
        ["get_knowledge", "ok"],
      ]);
      expect(rows.every((row) => row.userId === userId)).toBe(true);
      expect(JSON.stringify(rows)).not.toContain("Secret");
      expect(JSON.stringify(rows)).not.toContain(token);
    });
  });
});
