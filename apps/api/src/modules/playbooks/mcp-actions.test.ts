import { channelAccounts, playbooks, replyConditions, users } from "@leren/db";
import { createTestDatabase } from "@leren/db/testing";
import type { TestDatabase } from "@leren/db/testing";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { PLAYBOOK_FIELD_GUIDE, createPlaybookMcpActions } from "./mcp-actions";

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
  let accountId: string;
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

    accountId = await addAccount(userId, "a@example.com");

    actions = createPlaybookMcpActions(database.db, requestIndex, "https://app.example.com/");
  });

  async function addAccount(owner: string, label: string, status: "active" | "revoked" = "active") {
    const [account] = await database.db
      .insert(channelAccounts)
      .values({
        userId: owner,
        channel: "email",
        provider: "google",
        providerAccountId: `sub-${label}`,
        label,
        status,
      })
      .returning({ id: channelAccounts.id });

    return account?.id ?? "";
  }

  async function newPlaybook() {
    return (await run(actions.createPlaybook, userId, {
      topic: "Parking",
      information: "Free parking",
      timezone: "UTC",
    })) as Saved;
  }

  const create = (extra: Record<string, unknown> = {}) =>
    run(actions.createPlaybook, userId, {
      topic: "Parking",
      information: "Free parking",
      timezone: "UTC",
      ...extra,
    });

  const playbookCount = async () => (await database.db.select().from(playbooks)).length;

  describe("field guide", () => {
    it("marks only the topic, the information and the timezone as required", () => {
      const required = PLAYBOOK_FIELD_GUIDE.playbook
        .filter((field) => field.required)
        .map((field) => field.name);

      expect(required).toEqual(["topic", "information", "timezone"]);
    });

    it("gives the default of every field that is not required", () => {
      expect(PLAYBOOK_FIELD_GUIDE.playbook.find((field) => field.name === "enabled")).toMatchObject(
        { required: false, default: true },
      );
      expect(
        PLAYBOOK_FIELD_GUIDE.emailConditions.find((field) => field.name === "senderMode"),
      ).toMatchObject({ required: false, default: "any" });
    });

    it("describes every field", () => {
      const all = [...PLAYBOOK_FIELD_GUIDE.playbook, ...PLAYBOOK_FIELD_GUIDE.emailConditions];

      expect(all.filter((field) => field.description === "")).toEqual([]);
    });
  });

  describe("createPlaybook", () => {
    it("returns the link to the saved playbook", async () => {
      const created = await newPlaybook();

      expect(created.data.url).toBe(`https://app.example.com/playbooks/${created.id}`);
    });

    it("saves an enabled playbook with the email defaults and asks for it to be indexed", async () => {
      const created = (await run(actions.createPlaybook, userId, {
        topic: "Parking",
        information: "Free parking",
        timezone: "Asia/Jakarta",
      })) as Saved;

      expect(created.data).toMatchObject({
        topic: "Parking",
        enabled: true,
        usable: true,
        startsAt: null,
        endsAt: null,
        conditions: [
          { channel: "email", senderMode: "any", replyWhenTo: true, channelAccountId: accountId },
        ],
      });
      expect(requestIndex).toHaveBeenCalledWith(created.id);
    });

    describe("the account of a playbook that is on (decision 0044)", () => {
      it("tells the assistant to ask the user to connect an account when there is none", async () => {
        await database.db.delete(channelAccounts);

        const result = await create();

        expect(result).toMatchObject({ status: "invalid" });
        expect((result as { message: string }).message).toContain("no connected email account");
        expect(await playbookCount()).toBe(0);
        expect(requestIndex).not.toHaveBeenCalled();
      });

      it("lists the accounts, with their ids, when the user has several", async () => {
        const second = await addAccount(userId, "second@example.com");
        const result = (await create()) as { status: string; message: string };

        expect(result.status).toBe("invalid");
        expect(result.message).toContain(`a@example.com (${accountId})`);
        expect(result.message).toContain(`second@example.com (${second})`);
        expect(await playbookCount()).toBe(0);
      });

      it("uses the account that the assistant names", async () => {
        const second = await addAccount(userId, "second@example.com");

        const created = (await create({
          conditions: [{ channel: "email", channelAccountId: second }],
        })) as Saved;

        expect(created.data).toMatchObject({ conditions: [{ channelAccountId: second }] });
      });

      it("refuses an account of another user", async () => {
        const foreign = await addAccount(otherUserId, "b@example.com");

        const result = await create({
          conditions: [{ channel: "email", channelAccountId: foreign }],
        });

        expect(result).toMatchObject({ status: "invalid" });
        expect((result as { message: string }).message).toContain("not one of the user");
        expect(await playbookCount()).toBe(0);
      });

      it("ignores a revoked account when it chooses the only account", async () => {
        await addAccount(userId, "old@example.com", "revoked");

        const created = (await create()) as Saved;

        expect(created.data).toMatchObject({ conditions: [{ channelAccountId: accountId }] });
      });

      it("saves a playbook that is off without an account", async () => {
        await database.db.delete(channelAccounts);

        const created = (await create({ enabled: false })) as Saved;

        expect(created.data).toMatchObject({
          enabled: false,
          conditions: [{ channelAccountId: null }],
        });
      });
    });

    it("applies the conditions that the caller names on top of the defaults", async () => {
      const created = (await run(actions.createPlaybook, userId, {
        topic: "Parking",
        information: "Free parking",
        timezone: "UTC",
        conditions: [{ channel: "email", senderMode: "allowlist", senderAllowlist: ["@acme.com"] }],
      })) as Saved;

      expect(created.data).toMatchObject({
        conditions: [{ channel: "email", senderMode: "allowlist", replyWhenTo: true }],
      });
    });

    it("refuses an unknown timezone without writing", async () => {
      const timezone = await run(actions.createPlaybook, userId, {
        topic: "T",
        information: "R",
        timezone: "Mars/Olympus",
      });

      expect(timezone).toMatchObject({ status: "invalid" });
      expect(requestIndex).not.toHaveBeenCalled();
    });
  });

  describe("updatePlaybook", () => {
    it("changes only the named fields and keeps the conditions of channels it does not name", async () => {
      const created = await newPlaybook();

      const updated = (await run(actions.updatePlaybook, userId, {
        playbookId: created.id,
        information: "Free parking after 5 pm",
        endsAt: "2999-01-01T00:00:00.000Z",
      })) as Saved;

      expect(updated.data).toMatchObject({
        topic: "Parking",
        information: "Free parking after 5 pm",
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
        instruction: "None",
      })) as Saved;

      expect(result).toMatchObject({ status: "invalid" });
      expect(unchanged.data).toMatchObject({ topic: "Parking" });
    });

    it("gives a playbook that has no account the only account when it is changed while on", async () => {
      const created = await newPlaybook();

      await database.db
        .update(replyConditions)
        .set({ channelAccountId: null })
        .where(eq(replyConditions.playbookId, created.id));

      const updated = (await run(actions.updatePlaybook, userId, {
        playbookId: created.id,
        information: "Free parking after 5 pm",
      })) as Saved;

      expect(updated.data).toMatchObject({ conditions: [{ channelAccountId: accountId }] });
    });

    it("keeps a revoked account so that a playbook that is on can still be edited", async () => {
      const created = await newPlaybook();

      await database.db
        .update(channelAccounts)
        .set({ status: "revoked" })
        .where(eq(channelAccounts.id, accountId));

      const updated = (await run(actions.updatePlaybook, userId, {
        playbookId: created.id,
        information: "Free parking after 5 pm",
      })) as Saved;

      expect(updated.data).toMatchObject({
        information: "Free parking after 5 pm",
        conditions: [{ channelAccountId: accountId }],
      });
    });

    it("lists the active accounts when the assistant names a revoked account that the playbook does not use", async () => {
      const created = await newPlaybook();
      const old = await addAccount(userId, "old@example.com", "revoked");

      const result = (await run(actions.updatePlaybook, userId, {
        playbookId: created.id,
        conditions: [{ channel: "email", channelAccountId: old }],
      })) as { status: string; message: string };

      expect(result.status).toBe("invalid");
      expect(result.message).toContain(`The account ${old} is not one of the user`);
      expect(result.message).toContain(`a@example.com (${accountId})`);
    });

    it("needs an active account when a playbook is turned on", async () => {
      const created = (await run(actions.createPlaybook, userId, {
        topic: "Parking",
        information: "Free parking",
        timezone: "UTC",
        enabled: false,
      })) as Saved;

      await database.db
        .update(replyConditions)
        .set({ channelAccountId: accountId })
        .where(eq(replyConditions.playbookId, created.id));
      await database.db
        .update(channelAccounts)
        .set({ status: "revoked" })
        .where(eq(channelAccounts.id, accountId));

      const result = (await run(actions.updatePlaybook, userId, {
        playbookId: created.id,
        enabled: true,
      })) as { status: string; message: string };

      expect(result.status).toBe("invalid");
      expect(result.message).toContain("no connected email account");
    });

    it("asks which account to use when a playbook with none is turned on and there are several", async () => {
      const created = (await run(actions.createPlaybook, userId, {
        topic: "Parking",
        information: "Free parking",
        timezone: "UTC",
        enabled: false,
      })) as Saved;

      await addAccount(userId, "second@example.com");

      const result = await run(actions.updatePlaybook, userId, {
        playbookId: created.id,
        enabled: true,
      });

      expect(result).toMatchObject({ status: "invalid" });
      expect((result as { message: string }).message).toContain("several email accounts");
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
