import { autoReplyRules, users } from "@leren/db";
import { createTestDatabase } from "@leren/db/testing";
import type { TestDatabase } from "@leren/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createKnowledgeMcpActions } from "./mcp-actions";

const MISSING_ID = "00000000-0000-4000-8000-000000000000";

type Saved = { status: "saved"; id: string; data: Record<string, unknown> };

/** Runs an action with arguments that the MCP layer has already validated against its schema. */
function run(
  action: { run: (userId: string, input: never) => Promise<unknown> },
  userId: string,
  input: Record<string, unknown>,
) {
  return action.run(userId, input as never);
}

describe("knowledge MCP actions", () => {
  let database: TestDatabase;
  let userId: string;
  let otherUserId: string;
  let ruleId: string;
  let actions: ReturnType<typeof createKnowledgeMcpActions>;
  const requestIndex = vi.fn(async (_itemId: string) => {});

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database.drop();
  });

  beforeEach(async () => {
    await database.db.delete(users);
    requestIndex.mockClear();

    [{ id: userId }, { id: otherUserId }] = await database.db
      .insert(users)
      .values([{ email: "a@example.com" }, { email: "b@example.com" }])
      .returning({ id: users.id });

    [{ id: ruleId }] = await database.db
      .insert(autoReplyRules)
      .values({ userId, name: "Holiday", timezone: "UTC" })
      .returning({ id: autoReplyRules.id });

    actions = createKnowledgeMcpActions(database.db, requestIndex);
  });

  describe("createKnowledge", () => {
    it("saves a draft that is not usable and asks for it to be indexed", async () => {
      const item = (await run(actions.createKnowledge, userId, {
        ruleId,
        topic: "Parking",
        response: "Free parking",
      })) as Saved;

      expect(item.data).toMatchObject({
        topic: "Parking",
        approvalStatus: "draft",
        usable: false,
        examples: [],
        contacts: [],
      });
      expect(requestIndex).toHaveBeenCalledWith(item.id);
    });

    it("refuses another user's rule and an invalid contact without writing", async () => {
      const foreign = await run(actions.createKnowledge, otherUserId, {
        ruleId,
        topic: "T",
        response: "R",
      });

      const contact = await run(actions.createKnowledge, userId, {
        ruleId,
        topic: "T",
        response: "R",
        contacts: ["not an address"],
      });

      expect(foreign).toMatchObject({ status: "invalid" });
      expect(contact).toMatchObject({ status: "invalid" });
      expect(requestIndex).not.toHaveBeenCalled();
    });
  });

  describe("updateKnowledge", () => {
    async function newItem() {
      return (await run(actions.createKnowledge, userId, {
        ruleId,
        topic: "Parking",
        response: "Free parking",
        examples: ["Where can I park?"],
      })) as Saved;
    }

    it("changes only the named fields", async () => {
      const item = await newItem();

      const updated = (await run(actions.updateKnowledge, userId, {
        itemId: item.id,
        response: "Free parking after 5 pm",
      })) as Saved;

      expect(updated.data).toMatchObject({
        topic: "Parking",
        response: "Free parking after 5 pm",
        examples: ["Where can I park?"],
      });
      expect(requestIndex).toHaveBeenLastCalledWith(item.id);
    });

    it("rejects a change that makes the item invalid and keeps the stored text", async () => {
      const item = await newItem();

      const result = await run(actions.updateKnowledge, userId, {
        itemId: item.id,
        topic: "x".repeat(201),
      });

      expect(result).toMatchObject({ status: "invalid" });
      expect(requestIndex).toHaveBeenCalledTimes(1);
      expect(
        (await run(actions.updateKnowledge, userId, {
          itemId: item.id,
          restrictions: "None",
        })) as Saved,
      ).toMatchObject({ data: { topic: "Parking" } });
    });

    it("refuses an empty change, another user's item and a missing item", async () => {
      const item = await newItem();

      expect(await run(actions.updateKnowledge, userId, { itemId: item.id })).toMatchObject({
        status: "invalid",
      });
      expect(
        await run(actions.updateKnowledge, otherUserId, { itemId: item.id, topic: "X" }),
      ).toEqual({ status: "not_found" });
      expect(
        await run(actions.updateKnowledge, userId, { itemId: MISSING_ID, topic: "X" }),
      ).toEqual({ status: "not_found" });
    });
  });
});
