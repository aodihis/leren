import { mcpAuditLog, playbooks, replyConditions, users } from "@leren/db";
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
  let playbookId: string;
  let otherUserId: string;
  let otherPlaybookId: string;
  let actions: McpWriteActions;
  let createPlaybook: ReturnType<typeof stubAction>;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await endpoint?.close();
    await database.drop();
  });

  async function seedUser(email: string) {
    const [user] = await database.db.insert(users).values({ email }).returning({ id: users.id });

    const [playbook] = await database.db
      .insert(playbooks)
      .values({
        userId: user.id,
        topic: "Opening hours",
        response: "We open at nine",
        timezone: "UTC",
      })
      .returning();

    await database.db.insert(replyConditions).values({
      playbookId: playbook.id,
      channel: "email",
      settings: { senderMode: "allowlist", senderAllowlist: [`${email}-friend@x.com`] },
    });

    await store.ensureCollection({ name: KNOWLEDGE_COLLECTION, dimensions: embedder.dimensions });

    const [vector] = await embedder.embed([toEmbeddingText(playbook)]);

    await store.upsert(KNOWLEDGE_COLLECTION, [
      { id: playbook.id, vector, metadata: toVectorMetadata(playbook) },
    ]);

    return { userId: user.id, playbookId: playbook.id };
  }

  beforeEach(async () => {
    await database.db.delete(users);

    clock = NOW;
    store = createInMemoryVectorStore();
    createPlaybook = stubAction({ topic: z.string(), response: z.string() });

    actions = {
      createPlaybook: createPlaybook.action,
      updatePlaybook: stubAction({ playbookId: z.uuid() }).action,
    };

    endpoint = createMcpEndpoint({
      db: database.db,
      secret: SECRET,
      now: () => clock,
      search: { store, embedder },
      actions,
    });

    ({ userId, playbookId } = await seedUser("a@example.com"));
    ({ userId: otherUserId, playbookId: otherPlaybookId } = await seedUser("b@example.com"));
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
        expect.arrayContaining(["create_playbook", "update_playbook"]),
      );
      expect(toolNames(restricted)).toEqual(
        expect.arrayContaining(["list_playbooks", "get_playbook", "search_playbooks"]),
      );
      expect(toolNames(restricted)).not.toContain("create_playbook");
    });

    it("rejects a call to a tool outside the granted scopes", async () => {
      const token = await tokenFor({ scopes: ["playbooks:write"] });
      const result = await call(token, "get_playbook", { playbookId });

      expect(result.error ?? result.isError).toBeTruthy();
      expect(result.data ?? "").not.toContain("Opening hours");
    });

    it("rejects a write from a session without the write scope", async () => {
      const token = await tokenFor({ role: "reply", messageId: "m1" });

      const result = await call(token, "create_playbook", { topic: "T", response: "R" });

      expect(result.error ?? result.isError).toBeTruthy();
      expect(createPlaybook.run).not.toHaveBeenCalled();
    });

    it("offers only the write tools to a session that holds only the write scope", async () => {
      const writeOnly = toolNames(
        await rpc(await tokenFor({ scopes: ["playbooks:write"] }), "tools/list"),
      );

      expect(writeOnly).toEqual(["create_playbook", "update_playbook"]);
    });
  });

  describe("read tools", () => {
    it("lists the playbooks of the session's user only, with their conditions", async () => {
      const result = parsed(await call(await tokenFor(), "list_playbooks"));

      expect(result.playbooks.map((playbook: { id: string }) => playbook.id)).toEqual([playbookId]);
      expect(result.playbooks[0].conditions).toEqual([
        {
          channel: "email",
          senderMode: "allowlist",
          senderAllowlist: ["a@example.com-friend@x.com"],
          channelAccountId: null,
        },
      ]);
    });

    it("filters the list by enabled and by usability", async () => {
      const token = await tokenFor();

      await database.db
        .insert(playbooks)
        .values({ userId, topic: "Off", enabled: false, response: "r", timezone: "UTC" });

      const all = parsed(await call(token, "list_playbooks"));
      const usable = parsed(await call(token, "list_playbooks", { usableOnly: true }));
      const disabled = parsed(await call(token, "list_playbooks", { enabled: false }));

      expect(all.playbooks).toHaveLength(2);
      expect(usable.playbooks.map((playbook: { id: string }) => playbook.id)).toEqual([playbookId]);
      expect(disabled.playbooks.map((playbook: { topic: string }) => playbook.topic)).toEqual([
        "Off",
      ]);
    });

    it("gets a playbook, and treats another user's playbook as missing", async () => {
      const token = await tokenFor();
      const own = parsed(await call(token, "get_playbook", { playbookId }));

      expect(own).toMatchObject({ topic: "Opening hours", usable: true, periodStatus: "active" });

      const foreign = await call(token, "get_playbook", { playbookId: otherPlaybookId });

      expect(foreign.isError).toBe(true);
      expect(foreign.data).toBe("Not found");
      expect((await call(token, "get_playbook", { playbookId: MISSING_ID })).isError).toBe(true);
    });

    it("rejects invalid input", async () => {
      const result = await call(await tokenFor(), "get_playbook", { playbookId: "not-a-uuid" });

      expect(result.error ?? result.isError).toBeTruthy();
    });

    it("searches the user's enabled playbooks and returns their conditions", async () => {
      const found = parsed(
        await call(await tokenFor(), "search_playbooks", {
          query: "Opening hours We open at nine",
        }),
      );

      expect(found.status).toBe("found");
      expect(found.matches.map((match: { playbook: { id: string } }) => match.playbook.id)).toEqual(
        [playbookId],
      );
      expect(found.matches[0].playbook.conditions).toHaveLength(1);
    });

    it("reports that search is unavailable when it is not configured", async () => {
      endpoint = createMcpEndpoint({ db: database.db, secret: SECRET, now: () => clock });

      const result = await call(await tokenFor(), "search_playbooks", { query: "hours" });

      expect(result.isError).toBe(true);
      expect(result.data).toBe("Search is not configured");
    });

    it("reads a playbook as a resource and refuses another user's", async () => {
      const token = await tokenFor();
      const own = await rpc(token, "resources/read", { uri: `leren://playbooks/${playbookId}` });

      const foreign = await rpc(token, "resources/read", {
        uri: `leren://playbooks/${otherPlaybookId}`,
      });

      expect(JSON.parse(own.body?.result?.contents?.[0]?.text ?? "").id).toBe(playbookId);
      expect(foreign.body?.error).toBeDefined();
      expect(JSON.stringify(foreign.body)).not.toContain("Opening hours");
    });

    it("serves the answer prompt", async () => {
      const reply = await rpc(await tokenFor(), "prompts/get", {
        name: "answer_from_playbooks",
        arguments: { question: "When do you open?" },
      });

      expect(reply.body?.result?.messages?.[0]?.content.text).toContain("When do you open?");
    });
  });

  describe("write tools", () => {
    const newPlaybook = { topic: "Parking", response: "Free parking" };

    it("runs the action for the session's user and returns its result", async () => {
      const result = await call(await tokenFor(), "create_playbook", newPlaybook);

      expect(createPlaybook.run).toHaveBeenCalledWith(userId, newPlaybook);
      expect(parsed(result)).toEqual({ id: NEW_ID });
    });

    it("binds the call to the token's user and not to any argument", async () => {
      await call(await tokenFor({}, otherUserId), "create_playbook", { ...newPlaybook, userId });

      expect(createPlaybook.run.mock.calls[0]?.[0]).toBe(otherUserId);
    });

    it("rejects arguments that fail validation without running the action", async () => {
      const result = await call(await tokenFor(), "create_playbook", { topic: 1 });

      expect(result.error ?? result.isError).toBeTruthy();
      expect(createPlaybook.run).not.toHaveBeenCalled();
    });

    it("reports an invalid change and an unknown id as errors", async () => {
      const invalid = stubAction(
        { topic: z.string() },
        { status: "invalid", message: "Enter a topic" },
      );

      const missing = stubAction({ playbookId: z.uuid() }, { status: "not_found" });

      endpoint = createMcpEndpoint({
        db: database.db,
        secret: SECRET,
        now: () => clock,
        actions: { createPlaybook: invalid.action, updatePlaybook: missing.action },
      });

      const token = await tokenFor();
      const first = await call(token, "create_playbook", { topic: "x" });
      const second = await call(token, "update_playbook", { playbookId: MISSING_ID });

      expect(first).toMatchObject({ isError: true, data: "Enter a topic" });
      expect(second).toMatchObject({ isError: true, data: "Not found" });
    });

    it("does not register the write tools without actions", async () => {
      endpoint = createMcpEndpoint({ db: database.db, secret: SECRET, now: () => clock });

      expect(toolNames(await rpc(await tokenFor(), "tools/list"))).not.toContain("create_playbook");
    });
  });

  describe("another user's token", () => {
    it("acts only for its own user", async () => {
      const token = await tokenFor({}, otherUserId);
      const list = parsed(await call(token, "list_playbooks"));

      expect(list.playbooks.map((playbook: { id: string }) => playbook.id)).toEqual([
        otherPlaybookId,
      ]);
      expect((await call(token, "get_playbook", { playbookId })).isError).toBe(true);
    });
  });

  describe("audit log", () => {
    it("records calls rejected before a tool body runs, without their arguments", async () => {
      const limited = await tokenFor({ scopes: ["playbooks:write"] });

      await call(limited, "get_playbook", { playbookId });
      await call(await tokenFor(), "get_playbook", { playbookId: "not-a-uuid" });

      const rows = await database.db.select().from(mcpAuditLog);

      expect(rows.map((row) => [row.tool, row.outcome]).toSorted()).toEqual([
        ["get_playbook", "rejected"],
        ["get_playbook", "rejected"],
      ]);
      expect(rows.every((row) => Object.keys(row.summary).length === 0)).toBe(true);
    });

    it("records each call with its outcome and no playbook text", async () => {
      const token = await tokenFor();

      await call(token, "get_playbook", { playbookId });
      await call(token, "get_playbook", { playbookId: otherPlaybookId });
      await call(token, "create_playbook", {
        topic: "Secret topic",
        response: "Secret response",
      });

      const rows = await database.db.select().from(mcpAuditLog);

      expect(rows.map((row) => [row.tool, row.outcome]).toSorted()).toEqual([
        ["create_playbook", "ok"],
        ["get_playbook", "not_found"],
        ["get_playbook", "ok"],
      ]);
      expect(rows.every((row) => row.userId === userId)).toBe(true);
      expect(JSON.stringify(rows)).not.toContain("Secret");
      expect(JSON.stringify(rows)).not.toContain(token);
    });
  });
});
