import { users } from "@leren/db";
import { createTestDatabase } from "@leren/db/testing";
import type { TestDatabase } from "@leren/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createRuleMcpActions } from "./mcp-actions";

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

describe("rule MCP actions", () => {
  let database: TestDatabase;
  let userId: string;
  let otherUserId: string;
  let actions: ReturnType<typeof createRuleMcpActions>;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database.drop();
  });

  beforeEach(async () => {
    await database.db.delete(users);

    [{ id: userId }, { id: otherUserId }] = await database.db
      .insert(users)
      .values([{ email: "a@example.com" }, { email: "b@example.com" }])
      .returning({ id: users.id });

    actions = createRuleMcpActions(database.db);
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
});
