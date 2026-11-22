import { replyConditions, users } from "@leren/db";
import { createTestDatabase } from "@leren/db/testing";
import type { TestDatabase } from "@leren/db/testing";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createPlaybookMcpActions } from "./mcp-actions";

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

describe("playbook MCP actions", () => {
  let database: TestDatabase;
  let userId: string;
  let otherUserId: string;
  let actions: ReturnType<typeof createPlaybookMcpActions>;
  const requestIndex = vi.fn(async (_playbookId: string) => {});

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

    actions = createPlaybookMcpActions(database.db, requestIndex);
  });

  async function newPlaybook() {
    return (await run(actions.createPlaybook, userId, {
      topic: "Parking",
      response: "Free parking",
      timezone: "UTC",
      examples: ["Where can I park?"],
    })) as Saved;
  }

  describe("createPlaybook", () => {
    it("saves an enabled playbook with the email defaults and asks for it to be indexed", async () => {
      const created = (await run(actions.createPlaybook, userId, {
        topic: "Parking",
        response: "Free parking",
        timezone: "Asia/Jakarta",
      })) as Saved;

      expect(created.data).toMatchObject({
        topic: "Parking",
        enabled: true,
        usable: true,
        examples: [],
        contacts: [],
        startsAt: null,
        endsAt: null,
        conditions: [{ channel: "email", senderMode: "any", replyWhenTo: true }],
      });
      expect(requestIndex).toHaveBeenCalledWith(created.id);
    });

    it("applies the conditions that the caller names on top of the defaults", async () => {
      const created = (await run(actions.createPlaybook, userId, {
        topic: "Parking",
        response: "Free parking",
        timezone: "UTC",
        conditions: [{ channel: "email", senderMode: "allowlist", senderAllowlist: ["@acme.com"] }],
      })) as Saved;

      expect(created.data).toMatchObject({
        conditions: [{ channel: "email", senderMode: "allowlist", replyWhenTo: true }],
      });
    });

    it("refuses an invalid contact and an unknown timezone without writing", async () => {
      const contact = await run(actions.createPlaybook, userId, {
        topic: "T",
        response: "R",
        timezone: "UTC",
        contacts: ["not an address"],
      });

      const timezone = await run(actions.createPlaybook, userId, {
        topic: "T",
        response: "R",
        timezone: "Mars/Olympus",
      });

      expect(contact).toMatchObject({ status: "invalid" });
      expect(timezone).toMatchObject({ status: "invalid" });
      expect(requestIndex).not.toHaveBeenCalled();
    });
  });

  describe("updatePlaybook", () => {
    it("changes only the named fields and keeps the conditions of channels it does not name", async () => {
      const created = await newPlaybook();

      const updated = (await run(actions.updatePlaybook, userId, {
        playbookId: created.id,
        response: "Free parking after 5 pm",
        endsAt: "2999-01-01T00:00:00.000Z",
      })) as Saved;

      expect(updated.data).toMatchObject({
        topic: "Parking",
        response: "Free parking after 5 pm",
        examples: ["Where can I park?"],
        endsAt: "2999-01-01T00:00:00.000Z",
        conditions: [{ channel: "email" }],
      });
      expect(requestIndex).toHaveBeenLastCalledWith(created.id);
    });

    it("keeps the reply mode that the user chose when it changes the email conditions", async () => {
      const created = await newPlaybook();

      await database.db
        .update(replyConditions)
        .set({ settings: sql`${replyConditions.settings} || '{"replyMode":"send"}'::jsonb` })
        .where(eq(replyConditions.playbookId, created.id));

      const updated = (await run(actions.updatePlaybook, userId, {
        playbookId: created.id,
        conditions: [{ channel: "email", senderMode: "allowlist", senderAllowlist: ["@acme.com"] }],
      })) as Saved;

      expect(updated.data).toMatchObject({
        conditions: [{ channel: "email", senderMode: "allowlist", replyMode: "send" }],
      });
    });

    it("rejects a change that makes the playbook invalid and keeps the stored text", async () => {
      const created = await newPlaybook();

      const result = await run(actions.updatePlaybook, userId, {
        playbookId: created.id,
        topic: "x".repeat(201),
      });

      const unchanged = (await run(actions.updatePlaybook, userId, {
        playbookId: created.id,
        restrictions: "None",
      })) as Saved;

      expect(result).toMatchObject({ status: "invalid" });
      expect(unchanged.data).toMatchObject({ topic: "Parking" });
    });

    it("refuses an empty change, another user's playbook and a missing playbook", async () => {
      const created = await newPlaybook();

      expect(await run(actions.updatePlaybook, userId, { playbookId: created.id })).toMatchObject({
        status: "invalid",
      });
      expect(
        await run(actions.updatePlaybook, otherUserId, { playbookId: created.id, topic: "X" }),
      ).toEqual({ status: "not_found" });
      expect(
        await run(actions.updatePlaybook, userId, { playbookId: MISSING_ID, topic: "X" }),
      ).toEqual({ status: "not_found" });
    });
  });
});
