import { createTestDatabase } from "@leren/db/testing";
import type { TestDatabase } from "@leren/db/testing";
import { createInMemoryEmailSender } from "@leren/email/testing";
import type { InMemoryEmailSender } from "@leren/email/testing";
import type { Logger } from "@leren/logger";
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

type Created = {
  id: string;
  approvalStatus: string;
  usable: boolean;
  periodStatus: string;
  contacts: string[];
  conditions: { channel: string; senderAllowlist: string[] }[];
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

  const signIn = async (email: string) => {
    await post("/api/auth/email-otp/send-verification-otp", { email, type: "sign-in" });

    const otp = /\b\d{6}\b/.exec(sender.sent.at(-1)?.text ?? "")?.[0];
    const response = await post("/api/auth/sign-in/email-otp", { email, otp });

    return response.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
  };

  const call = (cookie: string, method: string, path: string, payload?: unknown) =>
    app.request(path, {
      method,
      headers: { "content-type": "application/json", cookie },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });

  const create = async (cookie: string, overrides: Partial<PlaybookInput> = {}) => {
    const response = await call(cookie, "POST", PATH, body(overrides));
    const { playbook } = await response.json();

    return playbook as Created;
  };

  const act = (cookie: string, id: string, action: string) =>
    call(cookie, "POST", `${PATH}/${id}/${action}`);

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
      ["POST", `${PATH}/${MISSING_ID}/approve`],
      ["DELETE", `${PATH}/${MISSING_ID}`],
    ]) {
      const response = await app.request(path, { method });

      expect(response.status, `${method} ${path}`).toBe(401);
    }
  });

  describe("creating and reading", () => {
    it("creates a draft with its conditions that is not usable yet", async () => {
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
          contacts: ["dewi@example.com", "@Don"],
          approvalStatus: "draft",
          approvedAt: null,
          periodStatus: "active",
          usable: false,
        },
      });
    });

    it("ignores an approval status sent in the body", async () => {
      const cookie = await signIn("sneaky@example.com");

      const created = await create(cookie, {
        approvalStatus: "approved",
      } as Partial<PlaybookInput>);

      expect(created.approvalStatus).toBe("draft");
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

    it("sends an edited approved playbook back to draft so that it is reviewed again", async () => {
      const cookie = await signIn("edit-approved@example.com");
      const created = await create(cookie);

      await act(cookie, created.id, "approve");

      const response = await call(
        cookie,
        "PUT",
        `${PATH}/${created.id}`,
        body({ response: "The project is late." }),
      );

      expect(response.status).toBe(200);
      expect((await response.json()).playbook).toMatchObject({
        response: "The project is late.",
        approvalStatus: "draft",
        approvedAt: null,
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

  describe("approval", () => {
    it("approves a draft, archives it and returns it to draft on restore", async () => {
      const cookie = await signIn("workflow@example.com");
      const created = await create(cookie);

      const approved = await (await act(cookie, created.id, "approve")).json();
      const archived = await (await act(cookie, created.id, "archive")).json();
      const restored = await (await act(cookie, created.id, "restore")).json();

      expect(approved.playbook).toMatchObject({ approvalStatus: "approved", usable: true });
      expect(approved.playbook.approvedAt).toEqual(expect.any(String));
      expect(archived.playbook).toMatchObject({ approvalStatus: "archived", usable: false });
      expect(restored.playbook).toMatchObject({
        approvalStatus: "draft",
        approvedAt: null,
        usable: false,
      });
    });

    it.each(["approve", "restore", "archive"] as const)(
      "answers 409 to %s when the status does not allow it",
      async (action) => {
        const cookie = await signIn(`conflict-${action}@example.com`);
        const approved = await create(cookie);
        const archived = await create(cookie);
        const draft = await create(cookie);

        await act(cookie, approved.id, "approve");
        await act(cookie, archived.id, "archive");

        const target = { approve: approved, restore: draft, archive: archived }[action];

        expect((await act(cookie, target.id, action)).status).toBe(409);
      },
    );

    it("lists only the playbooks that are approved and inside their period when asked", async () => {
      const cookie = await signIn("usable@example.com");

      const usable = await create(cookie, { topic: "usable" });
      const open = await create(cookie, { topic: "open", startsAt: PAST });
      const draft = await create(cookie, { topic: "draft" });
      const archived = await create(cookie, { topic: "archived" });
      const early = await create(cookie, { topic: "early", startsAt: FUTURE });
      const late = await create(cookie, { topic: "late", endsAt: PAST });

      for (const playbook of [usable, open, archived, early, late]) {
        await act(cookie, playbook.id, "approve");
      }

      await act(cookie, archived.id, "archive");

      const { playbooks } = await (await call(cookie, "GET", `${PATH}?usable=true`)).json();

      expect(playbooks.map((playbook: { id: string }) => playbook.id).toSorted()).toEqual(
        [usable.id, open.id].toSorted(),
      );
      expect(draft.usable).toBe(false);
    });

    it("filters the list by status", async () => {
      const cookie = await signIn("filters@example.com");

      await create(cookie);

      const approved = await create(cookie);

      await act(cookie, approved.id, "approve");

      const { playbooks } = await (await call(cookie, "GET", `${PATH}?status=approved`)).json();

      expect(playbooks.map((playbook: { id: string }) => playbook.id)).toEqual([approved.id]);
    });
  });

  describe("indexing", () => {
    it("requests indexing after each written change and not after a rejected one", async () => {
      const cookie = await signIn("index-requests@example.com");
      const created = await create(cookie);

      expect(requestKnowledgeIndex).toHaveBeenLastCalledWith(created.id);

      requestKnowledgeIndex.mockClear();

      await call(cookie, "PUT", `${PATH}/${created.id}`, body({ topic: "Changed" }));
      await act(cookie, created.id, "approve");
      await act(cookie, created.id, "archive");

      expect(requestKnowledgeIndex.mock.calls).toEqual([[created.id], [created.id], [created.id]]);

      requestKnowledgeIndex.mockClear();

      await act(cookie, created.id, "approve");
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

      await act(intruder, created.id, "approve");
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
      const approve = await act(intruder, created.id, "approve");
      const remove = await call(intruder, "DELETE", path);
      const stillThere = await call(owner, "GET", path);

      expect([read.status, replace.status, approve.status, remove.status]).toEqual([
        404, 404, 404, 404,
      ]);
      expect((await stillThere.json()).playbook).toMatchObject({
        topic: "Private",
        approvalStatus: "draft",
      });
    });
  });
});
