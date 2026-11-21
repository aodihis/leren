import { users } from "@leren/db";
import { createTestDatabase } from "@leren/db/testing";
import type { TestDatabase } from "@leren/db/testing";
import type { McpWriteActions } from "@leren/mcp-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createMcpWriteActions } from "./actions";

const MISSING_ID = "00000000-0000-4000-8000-000000000000";

type Saved = { status: "saved"; id: string; data: Record<string, unknown> };

/** Runs an action with arguments that the MCP layer has already validated against its schema. */
function run(
  action: McpWriteActions[keyof McpWriteActions],
  userId: string,
  input: Record<string, unknown>,
) {
  return action.run(userId, input as never);
}

describe("MCP write actions", () => {
  let database: TestDatabase;
  let userId: string;
  let otherUserId: string;
  let actions: McpWriteActions;
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

    actions = createMcpWriteActions(database.db, requestIndex);
  });

  async function newRule(owner = userId) {
    return (await run(actions.createRule, owner, {
      name: "Holiday",
      timezone: "UTC",
    })) as Saved;
  }

  describe("createRule", () => {
    it("saves a rule with the defaults of the web form", async () => {
      const rule = await newRule();

      expect(rule.status).toBe("saved");
      expect(rule.data).toMatchObject({
        name: "Holiday",
        enabled: true,
        timezone: "UTC",
        conditions: [
          {
            channel: "email",
            senderMode: "any",
            replyWhenTo: true,
            replyWhenCc: false,
            skipBulkMail: true,
          },
        ],
      });
    });

    it("applies the email conditions that the caller names and keeps the other defaults", async () => {
      const rule = (await run(actions.createRule, userId, {
        name: "Partners",
        timezone: "UTC",
        conditions: [
          { channel: "email", senderMode: "allowlist", senderAllowlist: ["@partner.org"] },
        ],
      })) as Saved;

      expect(rule.data.conditions).toMatchObject([
        {
          senderMode: "allowlist",
          senderAllowlist: ["@partner.org"],
          replyWhenTo: true,
        },
      ]);
    });

    it("accepts only the email channel in the arguments of the rule tools", () => {
      const args = { name: "A", timezone: "UTC" };

      const accepted = actions.createRule.inputSchema.safeParse({
        ...args,
        conditions: [{ channel: "email" }],
      });

      const refused = actions.createRule.inputSchema.safeParse({
        ...args,
        conditions: [{ channel: "slack" }],
      });

      expect(accepted.success).toBe(true);
      expect(refused.success).toBe(false);
    });

    it("rejects a timezone that does not exist and a rule that ends before it starts", async () => {
      const timezone = await run(actions.createRule, userId, {
        name: "A",
        timezone: "Nowhere/City",
      });

      const dates = await run(actions.createRule, userId, {
        name: "A",
        timezone: "UTC",
        startsAt: "2026-12-02T00:00:00Z",
        endsAt: "2026-12-01T00:00:00Z",
      });

      expect(timezone).toMatchObject({ status: "invalid" });
      expect(dates).toMatchObject({ status: "invalid" });
    });
  });

  describe("updateRule", () => {
    it("changes only the named fields", async () => {
      const { id } = await newRule();

      const updated = (await run(actions.updateRule, userId, {
        ruleId: id,
        name: "Summer",
        conditions: [{ channel: "email", skipBulkMail: false }],
      })) as Saved;

      expect(updated.data).toMatchObject({
        name: "Summer",
        timezone: "UTC",
        conditions: [{ channel: "email", skipBulkMail: false, replyWhenTo: true }],
      });
    });

    it("rejects a change that makes the rule invalid and keeps the stored rule", async () => {
      const { id } = await newRule();

      const result = await run(actions.updateRule, userId, {
        ruleId: id,
        timezone: "Nowhere/City",
      });

      expect(result).toMatchObject({ status: "invalid" });
      expect(
        (await run(actions.updateRule, userId, { ruleId: id, enabled: false })) as Saved,
      ).toMatchObject({ data: { timezone: "UTC" } });
    });

    it("refuses an empty change, another user's rule and a missing rule", async () => {
      const { id } = await newRule();

      expect(await run(actions.updateRule, userId, { ruleId: id })).toMatchObject({
        status: "invalid",
      });
      expect(await run(actions.updateRule, otherUserId, { ruleId: id, name: "X" })).toEqual({
        status: "not_found",
      });
      expect(await run(actions.updateRule, userId, { ruleId: MISSING_ID, name: "X" })).toEqual({
        status: "not_found",
      });
    });
  });

  describe("createKnowledge", () => {
    it("saves a draft that is not usable and asks for it to be indexed", async () => {
      const { id: ruleId } = await newRule();

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
      const { id: ruleId } = await newRule();

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
      const { id: ruleId } = await newRule();

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
