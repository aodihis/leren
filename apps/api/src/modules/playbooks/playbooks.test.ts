import { channelAccounts, replyConditions, users } from "@leren/db";
import { createTestDatabase } from "@leren/db/testing";
import type { TestDatabase } from "@leren/db/testing";
import { createInMemoryEmailSender } from "@leren/email/testing";
import type { InMemoryEmailSender } from "@leren/email/testing";
import type { Logger } from "@leren/logger";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createApp } from "../../app";
import { createAuth } from "../auth/service";
import type { PlaybookInput } from "./schema";

const ORIGIN = "http://localhost:5173";
const PATH = "/api/playbooks";
const MISSING_ID = "00000000-0000-4000-8000-000000000000";
const PAST = "2000-01-01T00:00:00.000Z";
const FUTURE = "2999-01-01T00:00:00.000Z";

const MCP_SECRET = "an-mcp-test-secret-of-at-least-32-chars";

function createSilentLogger(): Logger {
  const logger: Logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: () => logger,
  };

  return logger;
}

const validEmail: PlaybookInput["conditions"][number] = {
  channel: "email",
  replyMode: "draft",
  senderMode: "any",
  senderAllowlist: [],
  replyWhenTo: true,
  replyWhenCc: false,
  replyWhenBcc: false,
  requireSoleRecipient: false,
  mentionOverrides: false,
  mentionDetection: "alias",
  mentionAliases: [],
  threadMode: "both",
  skipBulkMail: true,
};

const validBody = {
  enabled: true,
  topic: "Project status",
  examples: ["How is the project going?"],
  response: "The project is on track.",
  restrictions: "Do not share the budget.",
  contacts: [],
  startsAt: null,
  endsAt: null,
  timezone: "Asia/Jakarta",
  conditions: [validEmail],
};

function body(overrides: Partial<PlaybookInput> = {}) {
  return { ...validBody, ...overrides };
}

function withAccount(channelAccountId: string | null) {
  return { conditions: [{ ...validEmail, channelAccountId }] };
}

type Created = {
  id: string;
  enabled: boolean;
  usable: boolean;
  periodStatus: string;
  contacts: string[];
  conditions: { channel: string; senderAllowlist: string[]; replyMode: string }[];
};

describe("playbooks API", () => {
  let database: TestDatabase;
  let sender: InMemoryEmailSender;
  let app: ReturnType<typeof createApp>;
  const requestKnowledgeIndex = vi.fn<(playbookId: string) => Promise<void>>();

  const post = (path: string, payload: unknown) =>
    app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify(payload),
    });

  const defaultAccounts = new Map<string, string>();

  const ensureDefaultAccount = async (email: string) => {
    const [existing] = await database.db
      .select({ id: channelAccounts.id })
      .from(channelAccounts)
      .where(eq(channelAccounts.providerAccountId, `default-${email}`));

    return existing?.id ?? addAccount(email, `default-${email}`);
  };

  const signIn = async (email: string) => {
    await post("/api/auth/email-otp/send-verification-otp", { email, type: "sign-in" });

    const otp = /\b\d{6}\b/.exec(sender.sent.at(-1)?.text ?? "")?.[0];
    const response = await post("/api/auth/sign-in/email-otp", { email, otp });

    const cookie = response.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");

    defaultAccounts.set(cookie, await ensureDefaultAccount(email));

    return cookie;
  };

  /**
   * Names the user's own account in every entry of a request that does not mention one, because an
   * enabled playbook must have an account (decision 0044). A test that wants no account passes
   * `null`.
   */
  function withDefaultAccount(cookie: string, payload: unknown): unknown {
    const conditions = (payload as { conditions?: unknown } | null)?.conditions;

    if (!Array.isArray(conditions)) {
      return payload;
    }

    return {
      ...(payload as object),
      conditions: conditions.map((entry: { channelAccountId?: string | null }) =>
        entry.channelAccountId === undefined
          ? { ...entry, channelAccountId: defaultAccounts.get(cookie) }
          : entry,
      ),
    };
  }

  const call = (cookie: string, method: string, path: string, payload?: unknown) =>
    app.request(path, {
      method,
      headers: { "content-type": "application/json", cookie },
      body: payload === undefined ? undefined : JSON.stringify(withDefaultAccount(cookie, payload)),
    });

  const create = async (cookie: string, overrides: Partial<PlaybookInput> = {}) => {
    const response = await call(cookie, "POST", PATH, body(overrides));
    const { playbook } = await response.json();

    return playbook as Created;
  };

  const setEnabled = (cookie: string, id: string, enabled: boolean) =>
    call(cookie, "PATCH", `${PATH}/${id}`, { enabled });

  const addAccount = async (email: string, providerAccountId: string, channel = "email") => {
    const [owner] = await database.db.select().from(users).where(eq(users.email, email));

    const [account] = await database.db
      .insert(channelAccounts)
      .values({
        userId: owner?.id ?? "",
        channel,
        provider: "google",
        providerAccountId,
        label: email,
      })
      .returning();

    return account?.id ?? "";
  };

  beforeAll(async () => {
    database = await createTestDatabase();
    sender = createInMemoryEmailSender();

    const logger = createSilentLogger();

    const auth = createAuth({
      db: database.db,
      emailSender: sender,
      logger,
      secret: "test-secret-test-secret-test-secret-1234",
      baseURL: "http://localhost:3000",
      trustedOrigins: [ORIGIN],
    });

    app = createApp({
      auth,
      db: database.db,
      logger,
      requestKnowledgeIndex,
      mcp: { secret: MCP_SECRET },
    });
  });

  afterAll(async () => {
    await database.drop();
  });

  it("rejects every route without a session", async () => {
    for (const [method, path] of [
      ["GET", PATH],
      ["POST", PATH],
      ["GET", `${PATH}/${MISSING_ID}`],
      ["PUT", `${PATH}/${MISSING_ID}`],
      ["PATCH", `${PATH}/${MISSING_ID}`],
      ["DELETE", `${PATH}/${MISSING_ID}`],
    ]) {
      const response = await app.request(path, { method });

      expect(response.status, `${method} ${path}`).toBe(401);
    }
  });

  describe("creating and reading", () => {
    it("creates an enabled playbook with its conditions that the assistant may use", async () => {
      const cookie = await signIn("author@example.com");

      const response = await call(
        cookie,
        "POST",
        PATH,
        body({ contacts: ["dewi@example.com", "@Don"] }),
      );

      expect(response.status).toBe(201);
      expect(await response.json()).toEqual({
        playbook: {
          ...validBody,
          id: expect.any(String),
          conditions: [{ ...validEmail, channelAccountId: expect.any(String) }],
          contacts: ["dewi@example.com", "@Don"],
          periodStatus: "active",
          usable: true,
        },
      });
    });

    it("creates a disabled playbook that is not usable", async () => {
      const cookie = await signIn("disabled@example.com");
      const created = await create(cookie, { enabled: false });

      expect(created).toMatchObject({ enabled: false, usable: false, periodStatus: "active" });
    });

    it.each([
      ["scheduled", FUTURE, null],
      ["expired", null, PAST],
      ["active", PAST, FUTURE],
    ] as const)(
      "derives the %s period status from the stored bounds",
      async (status, startsAt, endsAt) => {
        const cookie = await signIn(`period-${status}@example.com`);
        const created = await create(cookie, { startsAt, endsAt });
        const response = await call(cookie, "GET", `${PATH}/${created.id}`);

        expect(await response.json()).toMatchObject({
          playbook: { periodStatus: status, startsAt, endsAt },
        });
      },
    );

    it("returns 404 for an unknown playbook", async () => {
      const cookie = await signIn("unknown@example.com");

      expect((await call(cookie, "GET", `${PATH}/${MISSING_ID}`)).status).toBe(404);
    });
  });

  describe("channel accounts", () => {
    it("lets a playbook listen through the user's own account and returns the choice", async () => {
      const cookie = await signIn("listener@example.com");
      const accountId = await addAccount("listener@example.com", "sub-listener");

      const created = await create(cookie, withAccount(accountId));
      const response = await call(cookie, "GET", `${PATH}/${created.id}`);

      expect(await response.json()).toMatchObject({
        playbook: { conditions: [{ channel: "email", channelAccountId: accountId }] },
      });
    });

    it("rejects an account of another user on create and on replace, and writes nothing", async () => {
      const cookie = await signIn("borrower@example.com");

      await signIn("lender@example.com");

      const foreign = await addAccount("lender@example.com", "sub-lender");
      const own = await create(cookie, { ...withAccount(null), enabled: false });

      const created = await call(cookie, "POST", PATH, body(withAccount(foreign)));
      const replaced = await call(cookie, "PUT", `${PATH}/${own.id}`, body(withAccount(foreign)));

      expect(created.status).toBe(400);
      expect(replaced.status).toBe(400);
      expect(await replaced.json()).toEqual({
        fieldErrors: { channelAccountId: ["Choose one of your own connected accounts"] },
      });

      const [row] = await database.db
        .select()
        .from(replyConditions)
        .where(eq(replyConditions.playbookId, own.id));

      expect(row?.channelAccountId).toBeNull();
      expect((await (await call(cookie, "GET", PATH)).json()).playbooks).toHaveLength(1);
    });

    it("rejects an account that is on another channel and an account that does not exist", async () => {
      const cookie = await signIn("mismatch@example.com");
      const slack = await addAccount("mismatch@example.com", "T123", "slack");

      for (const accountId of [slack, MISSING_ID]) {
        const response = await call(cookie, "POST", PATH, body(withAccount(accountId)));

        expect(response.status).toBe(400);
      }
    });

    describe("the account of an enabled playbook (decision 0044)", () => {
      const REQUIRED = "Choose the account that this playbook answers on, or turn the playbook off";

      it("rejects an enabled playbook without an account on create and on replace", async () => {
        const cookie = await signIn("needs-account@example.com");
        const own = await create(cookie, { ...withAccount(null), enabled: false });

        const created = await call(cookie, "POST", PATH, body(withAccount(null)));
        const replaced = await call(cookie, "PUT", `${PATH}/${own.id}`, body(withAccount(null)));

        for (const response of [created, replaced]) {
          expect(response.status).toBe(400);
          expect(await response.json()).toEqual({ fieldErrors: { channelAccountId: [REQUIRED] } });
        }

        const listed = (await (await call(cookie, "GET", PATH)).json()).playbooks as Created[];

        expect(listed).toHaveLength(1);
        expect(listed[0]?.enabled).toBe(false);
      });

      it("accepts a disabled playbook without an account", async () => {
        const cookie = await signIn("draft-playbook@example.com");
        const created = await create(cookie, { ...withAccount(null), enabled: false });

        expect(created).toMatchObject({ enabled: false });
      });

      it("refuses to turn a playbook on until it names an account, and turns it off at any time", async () => {
        const cookie = await signIn("toggler@example.com");
        const own = await create(cookie, { ...withAccount(null), enabled: false });

        const indexRequests = requestKnowledgeIndex.mock.calls.length;
        const refused = await setEnabled(cookie, own.id, true);

        expect(refused.status).toBe(400);
        expect(await refused.json()).toEqual({ fieldErrors: { channelAccountId: [REQUIRED] } });
        expect(requestKnowledgeIndex.mock.calls).toHaveLength(indexRequests);

        const named = await call(cookie, "PUT", `${PATH}/${own.id}`, body({ enabled: false }));

        expect(named.status).toBe(200);
        expect((await setEnabled(cookie, own.id, true)).status).toBe(200);

        await database.db
          .update(replyConditions)
          .set({ channelAccountId: null })
          .where(eq(replyConditions.playbookId, own.id));

        expect((await setEnabled(cookie, own.id, false)).status).toBe(200);
      });

      it("lets an enabled playbook keep a revoked account when it is replaced, but not be turned on with it", async () => {
        const cookie = await signIn("keeper@example.com");
        const accountId = await addAccount("keeper@example.com", "sub-keeper");
        const created = await create(cookie, withAccount(accountId));

        await database.db
          .update(channelAccounts)
          .set({ status: "revoked" })
          .where(eq(channelAccounts.id, accountId));

        const renamed = await call(
          cookie,
          "PUT",
          `${PATH}/${created.id}`,
          body({ ...withAccount(accountId), topic: "Renamed" }),
        );

        expect(renamed.status).toBe(200);
        expect((await setEnabled(cookie, created.id, false)).status).toBe(200);

        const turnedOn = await setEnabled(cookie, created.id, true);

        const replacedOn = await call(
          cookie,
          "PUT",
          `${PATH}/${created.id}`,
          body({ ...withAccount(accountId), enabled: true }),
        );

        expect(turnedOn.status).toBe(400);
        expect(replacedOn.status).toBe(400);
        expect(await replacedOn.json()).toEqual({
          fieldErrors: { channelAccountId: ["Choose one of your own connected accounts"] },
        });
      });

      it("rejects a revoked account for an enabled playbook and accepts it for a disabled one", async () => {
        const cookie = await signIn("revoked@example.com");
        const accountId = await addAccount("revoked@example.com", "sub-revoked");

        await database.db
          .update(channelAccounts)
          .set({ status: "revoked" })
          .where(eq(channelAccounts.id, accountId));

        const enabled = await call(cookie, "POST", PATH, body(withAccount(accountId)));

        const disabled = await call(
          cookie,
          "POST",
          PATH,
          body({ ...withAccount(accountId), enabled: false }),
        );

        expect(enabled.status).toBe(400);
        expect(await enabled.json()).toEqual({
          fieldErrors: { channelAccountId: ["Choose one of your own connected accounts"] },
        });
        expect(disabled.status).toBe(201);
      });
    });

    it("keeps the playbook but drops the choice when the account is deleted", async () => {
      const cookie = await signIn("dropper@example.com");
      const accountId = await addAccount("dropper@example.com", "sub-dropper");
      const created = await create(cookie, withAccount(accountId));

      await database.db.delete(channelAccounts).where(eq(channelAccounts.id, accountId));

      const response = await call(cookie, "GET", `${PATH}/${created.id}`);

      expect(await response.json()).toMatchObject({
        playbook: { conditions: [{ channelAccountId: null }] },
      });
    });
  });

  describe("validation", () => {
    it.each([
      ["a blank topic", { topic: " " }, "topic"],
      ["a blank response", { response: "" }, "response"],
      [
        "an end before the start",
        { startsAt: "2026-12-10T00:00:00Z", endsAt: "2026-12-01T00:00:00Z" },
        "endsAt",
      ],
      ["an unknown timezone", { timezone: "Mars/Olympus" }, "timezone"],
      ["a bound without an offset", { startsAt: "2026-12-01T00:00:00" }, "startsAt"],
    ] as const)("rejects %s with a field error", async (_name, change, field) => {
      const cookie = await signIn("validation@example.com");
      const response = await call(cookie, "POST", PATH, { ...validBody, ...change });

      expect(response.status).toBe(400);
      expect(Object.keys((await response.json()).fieldErrors)).toEqual([field]);
    });

    it("stores the contacts without repeats and rejects an entry that is neither an address nor a handle", async () => {
      const cookie = await signIn("contacts@example.com");

      const created = await create(cookie, {
        contacts: ["a@example.com", "A@Example.com", "@Lin", "Don"],
      });

      const invalid = await call(cookie, "POST", PATH, body({ contacts: ["two words", "x@"] }));

      expect(created.contacts).toEqual(["a@example.com", "@Lin", "Don"]);
      expect(invalid.status).toBe(400);
      expect((await invalid.json()).fieldErrors).toHaveProperty("contacts");
    });

    it("defaults the reply mode to draft, keeps send when chosen, and rejects any other value", async () => {
      const cookie = await signIn("reply-mode@example.com");
      const { replyMode: _omitted, ...withoutMode } = validEmail;

      const defaulted = await call(
        cookie,
        "POST",
        PATH,
        body({ conditions: [withoutMode as never] }),
      );

      const sending = await create(cookie, { conditions: [{ ...validEmail, replyMode: "send" }] });

      const invalid = await call(
        cookie,
        "POST",
        PATH,
        body({ conditions: [{ ...validEmail, replyMode: "auto" as never }] }),
      );

      expect((await defaulted.json()).playbook.conditions[0].replyMode).toBe("draft");
      expect(sending.conditions[0]).toMatchObject({ replyMode: "send" });
      expect(invalid.status).toBe(400);
    });

    it("rejects an invalid sender allowlist entry and normalizes valid entries to lowercase", async () => {
      const cookie = await signIn("allowlist@example.com");

      const invalid = await call(
        cookie,
        "POST",
        PATH,
        body({ conditions: [{ ...validEmail, senderAllowlist: ["not an address"] }] }),
      );

      const created = await create(cookie, {
        conditions: [{ ...validEmail, senderAllowlist: [" Boss@ACME.com "] }],
      });

      expect(invalid.status).toBe(400);
      expect(created.conditions[0].senderAllowlist).toEqual(["boss@acme.com"]);
    });

    it("rejects no conditions, a repeated channel and an unknown channel", async () => {
      const cookie = await signIn("channels@example.com");

      const none = await call(cookie, "POST", PATH, body({ conditions: [] }));

      const repeated = await call(
        cookie,
        "POST",
        PATH,
        body({ conditions: [validEmail, validEmail] }),
      );

      const unknown = await call(cookie, "POST", PATH, {
        ...validBody,
        conditions: [{ ...validEmail, channel: "pigeon" }],
      });

      expect([none.status, repeated.status, unknown.status]).toEqual([400, 400, 400]);
      expect(JSON.stringify(await unknown.json())).toContain("Only the email channel is supported");
    });
  });

  describe("updating and deleting", () => {
    it("replaces the playbook and its conditions on update", async () => {
      const cookie = await signIn("updater@example.com");
      const created = await create(cookie);

      const changed = body({
        topic: "Renamed",
        contacts: ["second@example.com", "@Don"],
        conditions: [{ ...validEmail, senderMode: "allowlist", senderAllowlist: ["@acme.com"] }],
      });

      const response = await call(cookie, "PUT", `${PATH}/${created.id}`, changed);

      expect(response.status).toBe(200);
      expect((await response.json()).playbook).toMatchObject({ ...changed, id: created.id });
    });

    it("keeps a playbook enabled or disabled as the body says", async () => {
      const cookie = await signIn("edit-enabled@example.com");
      const created = await create(cookie);

      const response = await call(
        cookie,
        "PUT",
        `${PATH}/${created.id}`,
        body({ enabled: false, response: "The project is late." }),
      );

      expect((await response.json()).playbook).toMatchObject({
        response: "The project is late.",
        enabled: false,
        usable: false,
      });
    });

    it("deletes a playbook", async () => {
      const cookie = await signIn("deleter@example.com");
      const created = await create(cookie);

      const deleted = await call(cookie, "DELETE", `${PATH}/${created.id}`);
      const fetched = await call(cookie, "GET", `${PATH}/${created.id}`);

      expect(deleted.status).toBe(204);
      expect(fetched.status).toBe(404);
    });
  });

  describe("enabling", () => {
    it("turns a playbook off and on without changing anything else", async () => {
      const cookie = await signIn("toggle@example.com");
      const created = await create(cookie, { topic: "Toggle me" });

      const off = await (await setEnabled(cookie, created.id, false)).json();
      const on = await (await setEnabled(cookie, created.id, true)).json();

      expect(off.playbook).toMatchObject({ topic: "Toggle me", enabled: false, usable: false });
      expect(on.playbook).toMatchObject({ topic: "Toggle me", enabled: true, usable: true });
    });

    it("rejects a body that is not a boolean", async () => {
      const cookie = await signIn("toggle-invalid@example.com");
      const created = await create(cookie);

      const response = await call(cookie, "PATCH", `${PATH}/${created.id}`, { enabled: "yes" });

      expect(response.status).toBe(400);
    });

    it("lists only the playbooks that are enabled and inside their period when asked", async () => {
      const cookie = await signIn("usable@example.com");

      const usable = await create(cookie, { topic: "usable" });
      const open = await create(cookie, { topic: "open", startsAt: PAST });
      const off = await create(cookie, { topic: "off", enabled: false });
      const early = await create(cookie, { topic: "early", startsAt: FUTURE });
      const late = await create(cookie, { topic: "late", endsAt: PAST });

      const { playbooks } = await (await call(cookie, "GET", `${PATH}?usable=true`)).json();

      expect(playbooks.map((playbook: { id: string }) => playbook.id).toSorted()).toEqual(
        [usable.id, open.id].toSorted(),
      );
      expect([off.usable, early.usable, late.usable]).toEqual([false, false, false]);
    });

    it("filters the list by enabled", async () => {
      const cookie = await signIn("filters@example.com");

      await create(cookie);

      const off = await create(cookie, { enabled: false });
      const { playbooks } = await (await call(cookie, "GET", `${PATH}?enabled=false`)).json();

      expect(playbooks.map((playbook: { id: string }) => playbook.id)).toEqual([off.id]);
    });
  });

  describe("indexing", () => {
    it("requests indexing after each written change and not after a rejected one", async () => {
      const cookie = await signIn("index-requests@example.com");
      const created = await create(cookie);

      expect(requestKnowledgeIndex).toHaveBeenLastCalledWith(created.id);

      requestKnowledgeIndex.mockClear();

      await call(cookie, "PUT", `${PATH}/${created.id}`, body({ topic: "Changed" }));
      await setEnabled(cookie, created.id, false);
      await setEnabled(cookie, created.id, true);

      expect(requestKnowledgeIndex.mock.calls).toEqual([[created.id], [created.id], [created.id]]);

      requestKnowledgeIndex.mockClear();

      await call(cookie, "POST", PATH, body({ topic: " " }));
      await call(cookie, "PUT", `${PATH}/${MISSING_ID}`, body());
      await call(cookie, "DELETE", `${PATH}/${MISSING_ID}`);

      expect(requestKnowledgeIndex).not.toHaveBeenCalled();

      await call(cookie, "DELETE", `${PATH}/${created.id}`);

      expect(requestKnowledgeIndex).toHaveBeenCalledExactlyOnceWith(created.id);
    });

    it("does not request indexing for the playbooks of another user", async () => {
      const owner = await signIn("index-owner@example.com");
      const intruder = await signIn("index-intruder@example.com");
      const created = await create(owner);

      requestKnowledgeIndex.mockClear();

      await setEnabled(intruder, created.id, false);
      await call(intruder, "DELETE", `${PATH}/${created.id}`);

      expect(requestKnowledgeIndex).not.toHaveBeenCalled();
    });
  });

  describe("ownership", () => {
    it("lists only the signed-in user's playbooks", async () => {
      const owner = await signIn("lister@example.com");
      const other = await signIn("other-lister@example.com");

      await create(owner, { topic: "Mine" });
      await create(other, { topic: "Theirs" });

      const { playbooks } = await (await call(owner, "GET", PATH)).json();

      expect(playbooks.map((playbook: { topic: string }) => playbook.topic)).toEqual(["Mine"]);
    });

    it("hides the playbooks of one user from another user", async () => {
      const owner = await signIn("pb-owner@example.com");
      const intruder = await signIn("pb-intruder@example.com");
      const created = await create(owner, { topic: "Private" });
      const path = `${PATH}/${created.id}`;

      const read = await call(intruder, "GET", path);
      const replace = await call(intruder, "PUT", path, body({ topic: "Hacked" }));
      const toggle = await setEnabled(intruder, created.id, false);
      const remove = await call(intruder, "DELETE", path);
      const stillThere = await call(owner, "GET", path);

      expect([read.status, replace.status, toggle.status, remove.status]).toEqual([
        404, 404, 404, 404,
      ]);
      expect((await stillThere.json()).playbook).toMatchObject({
        topic: "Private",
        enabled: true,
      });
    });
  });
});
