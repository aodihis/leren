import { createTestDatabase } from "@leren/db/testing";
import type { TestDatabase } from "@leren/db/testing";
import { createInMemoryEmailSender } from "@leren/email/testing";
import type { InMemoryEmailSender } from "@leren/email/testing";
import type { Logger } from "@leren/logger";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createApp } from "../../app";
import { createAuth } from "../auth/service";
import type { ContactInput } from "../contacts/schema";
import type { KnowledgeItemInput } from "./schema";

const ORIGIN = "http://localhost:5173";
const ITEMS = "/api/knowledge-items";
const CONTACTS = "/api/contacts";
const MISSING_ID = "00000000-0000-4000-8000-000000000000";
const PAST = "2000-01-01T00:00:00.000Z";
const FUTURE = "2999-01-01T00:00:00.000Z";

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

const ruleBody = {
  name: "Holiday",
  enabled: true,
  startsAt: null,
  endsAt: null,
  timezone: "Asia/Jakarta",
  email: {
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
  },
};

function itemBody(ruleId: string, overrides: Partial<KnowledgeItemInput> = {}) {
  return {
    ruleId,
    topic: "Project status",
    examples: ["How is the project going?"],
    response: "The project is on track.",
    restrictions: "Do not share the budget.",
    validFrom: null,
    validUntil: null,
    contactIds: [],
    ...overrides,
  };
}

describe("knowledge items and contacts API", () => {
  let database: TestDatabase;
  let sender: InMemoryEmailSender;
  let app: ReturnType<typeof createApp>;

  const post = (path: string, body: unknown) =>
    app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify(body),
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

  const call = (cookie: string, method: string, path: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: { "content-type": "application/json", cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  const createRule = async (cookie: string) => {
    const response = await call(cookie, "POST", "/api/auto-reply-rules", ruleBody);
    const { rule } = await response.json();

    return rule.id as string;
  };

  const createContact = async (cookie: string, contact: Partial<ContactInput> = {}) => {
    const response = await call(cookie, "POST", CONTACTS, {
      name: "Dewi",
      email: "dewi@example.com",
      role: "Project lead",
      ...contact,
    });

    const body = await response.json();

    return body.contact.id as string;
  };

  const createItem = async (
    cookie: string,
    ruleId: string,
    overrides: Partial<KnowledgeItemInput> = {},
  ) => {
    const response = await call(cookie, "POST", ITEMS, itemBody(ruleId, overrides));
    const { item } = await response.json();

    return item as { id: string; approvalStatus: string; usable: boolean };
  };

  const act = (cookie: string, id: string, action: string) =>
    call(cookie, "POST", `${ITEMS}/${id}/${action}`);

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

    app = createApp({ auth, db: database.db, logger });
  });

  afterAll(async () => {
    await database.drop();
  });

  it("rejects every route without a session", async () => {
    for (const [method, path] of [
      ["GET", ITEMS],
      ["POST", ITEMS],
      ["GET", `${ITEMS}/${MISSING_ID}`],
      ["PUT", `${ITEMS}/${MISSING_ID}`],
      ["POST", `${ITEMS}/${MISSING_ID}/approve`],
      ["DELETE", `${ITEMS}/${MISSING_ID}`],
      ["GET", CONTACTS],
      ["POST", CONTACTS],
      ["PUT", `${CONTACTS}/${MISSING_ID}`],
      ["DELETE", `${CONTACTS}/${MISSING_ID}`],
    ]) {
      const response = await app.request(path, { method });

      expect(response.status, `${method} ${path}`).toBe(401);
    }
  });

  describe("knowledge items", () => {
    it("creates a draft item with its contacts that is not usable yet", async () => {
      const cookie = await signIn("author@example.com");
      const ruleId = await createRule(cookie);
      const contactId = await createContact(cookie);

      const response = await call(
        cookie,
        "POST",
        ITEMS,
        itemBody(ruleId, { contactIds: [contactId] }),
      );

      expect(response.status).toBe(201);
      const { contactIds: _contactIds, ...expectedFields } = itemBody(ruleId);

      expect(await response.json()).toEqual({
        item: {
          ...expectedFields,
          id: expect.any(String),
          approvalStatus: "draft",
          approvedAt: null,
          usable: false,
          contacts: [
            { id: contactId, name: "Dewi", email: "dewi@example.com", role: "Project lead" },
          ],
        },
      });
    });

    it("ignores an approval status sent in the body", async () => {
      const cookie = await signIn("sneaky@example.com");
      const ruleId = await createRule(cookie);

      const item = await createItem(cookie, ruleId, {
        approvalStatus: "approved",
      } as Partial<KnowledgeItemInput>);

      expect(item.approvalStatus).toBe("draft");
    });

    it("rejects invalid bodies with field errors", async () => {
      const cookie = await signIn("invalid@example.com");
      const ruleId = await createRule(cookie);

      const response = await call(
        cookie,
        "POST",
        ITEMS,
        itemBody(ruleId, { topic: " ", response: "", validFrom: FUTURE, validUntil: PAST }),
      );

      expect(response.status).toBe(400);
      expect(Object.keys((await response.json()).fieldErrors).toSorted()).toEqual([
        "response",
        "topic",
        "validUntil",
      ]);
    });

    it("rejects a rule or a contact that belongs to another user", async () => {
      const owner = await signIn("owner-refs@example.com");
      const other = await signIn("other-refs@example.com");
      const ownersRule = await createRule(owner);
      const othersRule = await createRule(other);
      const othersContact = await createContact(other);

      const foreignRule = await call(owner, "POST", ITEMS, itemBody(othersRule));

      const foreignContact = await call(
        owner,
        "POST",
        ITEMS,
        itemBody(ownersRule, { contactIds: [othersContact] }),
      );

      expect(foreignRule.status).toBe(400);
      expect((await foreignRule.json()).fieldErrors).toHaveProperty("ruleId");
      expect(foreignContact.status).toBe(400);
      expect((await foreignContact.json()).fieldErrors).toHaveProperty("contactIds");
    });

    it("approves a draft, archives it and returns it to draft on restore", async () => {
      const cookie = await signIn("workflow@example.com");
      const item = await createItem(cookie, await createRule(cookie));

      const approved = await (await act(cookie, item.id, "approve")).json();
      const archived = await (await act(cookie, item.id, "archive")).json();
      const restored = await (await act(cookie, item.id, "restore")).json();

      expect(approved.item).toMatchObject({ approvalStatus: "approved", usable: true });
      expect(approved.item.approvedAt).toEqual(expect.any(String));
      expect(archived.item).toMatchObject({ approvalStatus: "archived", usable: false });
      expect(restored.item).toMatchObject({
        approvalStatus: "draft",
        approvedAt: null,
        usable: false,
      });
    });

    it.each([
      ["approve", "approve"],
      ["restore", "restore"],
      ["archive", "archive"],
    ] as const)("answers 409 to %s when the status does not allow it", async (_name, action) => {
      const cookie = await signIn(`conflict-${action}@example.com`);
      const ruleId = await createRule(cookie);
      const approved = await createItem(cookie, ruleId);
      const archived = await createItem(cookie, ruleId);
      const draft = await createItem(cookie, ruleId);

      await act(cookie, approved.id, "approve");
      await act(cookie, archived.id, "archive");

      const target = { approve: approved, restore: draft, archive: archived }[action];
      const response = await act(cookie, target.id, action);

      expect(response.status).toBe(409);
    });

    it("sends an edited approved item back to draft so that it is reviewed again", async () => {
      const cookie = await signIn("edit-approved@example.com");
      const ruleId = await createRule(cookie);
      const item = await createItem(cookie, ruleId);

      await act(cookie, item.id, "approve");

      const response = await call(
        cookie,
        "PUT",
        `${ITEMS}/${item.id}`,
        itemBody(ruleId, { response: "The project is late." }),
      );

      expect(response.status).toBe(200);
      expect((await response.json()).item).toMatchObject({
        response: "The project is late.",
        approvalStatus: "draft",
        approvedAt: null,
        usable: false,
      });
    });

    it("replaces the contacts of an item on update", async () => {
      const cookie = await signIn("edit-contacts@example.com");
      const ruleId = await createRule(cookie);
      const first = await createContact(cookie, { email: "first@example.com", name: "First" });
      const second = await createContact(cookie, { email: "second@example.com", name: "Second" });
      const item = await createItem(cookie, ruleId, { contactIds: [first] });

      const response = await call(
        cookie,
        "PUT",
        `${ITEMS}/${item.id}`,
        itemBody(ruleId, { contactIds: [second] }),
      );

      expect((await response.json()).item.contacts.map((c: { id: string }) => c.id)).toEqual([
        second,
      ]);
    });

    it("lists only the items that are approved and inside their validity window when asked", async () => {
      const cookie = await signIn("usable@example.com");
      const ruleId = await createRule(cookie);

      const usable = await createItem(cookie, ruleId, { topic: "usable" });
      const open = await createItem(cookie, ruleId, { topic: "open", validFrom: PAST });
      const draft = await createItem(cookie, ruleId, { topic: "draft" });
      const archived = await createItem(cookie, ruleId, { topic: "archived" });
      const early = await createItem(cookie, ruleId, { topic: "early", validFrom: FUTURE });
      const late = await createItem(cookie, ruleId, { topic: "late", validUntil: PAST });

      for (const item of [usable, open, archived, early, late]) {
        await act(cookie, item.id, "approve");
      }

      await act(cookie, archived.id, "archive");

      const response = await call(cookie, "GET", `${ITEMS}?usable=true`);
      const { items } = await response.json();

      expect(items.map((item: { id: string }) => item.id).toSorted()).toEqual(
        [usable.id, open.id].toSorted(),
      );
      expect(draft.usable).toBe(false);
      expect(items.every((item: { usable: boolean }) => item.usable)).toBe(true);
    });

    it("filters the list by rule and by status", async () => {
      const cookie = await signIn("filters@example.com");
      const firstRule = await createRule(cookie);
      const secondRule = await createRule(cookie);
      const inFirst = await createItem(cookie, firstRule);
      const inSecond = await createItem(cookie, secondRule);

      await act(cookie, inSecond.id, "approve");

      const byRule = await (await call(cookie, "GET", `${ITEMS}?ruleId=${firstRule}`)).json();
      const byStatus = await (await call(cookie, "GET", `${ITEMS}?status=approved`)).json();

      expect(byRule.items.map((item: { id: string }) => item.id)).toEqual([inFirst.id]);
      expect(byStatus.items.map((item: { id: string }) => item.id)).toEqual([inSecond.id]);
    });

    it("deletes an item", async () => {
      const cookie = await signIn("delete-item@example.com");
      const item = await createItem(cookie, await createRule(cookie));

      const deleted = await call(cookie, "DELETE", `${ITEMS}/${item.id}`);
      const fetched = await call(cookie, "GET", `${ITEMS}/${item.id}`);

      expect(deleted.status).toBe(204);
      expect(fetched.status).toBe(404);
    });

    it("keeps an item when its contact is deleted", async () => {
      const cookie = await signIn("delete-contact@example.com");
      const contactId = await createContact(cookie);
      const item = await createItem(cookie, await createRule(cookie), { contactIds: [contactId] });

      await call(cookie, "DELETE", `${CONTACTS}/${contactId}`);

      const fetched = await (await call(cookie, "GET", `${ITEMS}/${item.id}`)).json();

      expect(fetched.item.contacts).toEqual([]);
    });

    it("hides the items of one user from another user", async () => {
      const owner = await signIn("item-owner@example.com");
      const intruder = await signIn("item-intruder@example.com");
      const ruleId = await createRule(owner);
      const item = await createItem(owner, ruleId);

      const list = await (await call(intruder, "GET", ITEMS)).json();
      const read = await call(intruder, "GET", `${ITEMS}/${item.id}`);
      const replace = await call(intruder, "PUT", `${ITEMS}/${item.id}`, itemBody(ruleId));
      const approve = await act(intruder, item.id, "approve");
      const remove = await call(intruder, "DELETE", `${ITEMS}/${item.id}`);
      const stillThere = await call(owner, "GET", `${ITEMS}/${item.id}`);

      expect(list.items).toEqual([]);
      expect([read.status, replace.status, approve.status, remove.status]).toEqual([
        404, 404, 404, 404,
      ]);
      expect((await stillThere.json()).item.approvalStatus).toBe("draft");
    });
  });

  describe("contacts", () => {
    it("creates, lists, replaces and deletes a contact", async () => {
      const cookie = await signIn("contacts@example.com");
      const id = await createContact(cookie, { email: "Mixed@Example.com" });

      const replaced = await call(cookie, "PUT", `${CONTACTS}/${id}`, {
        name: "Dewi A.",
        email: "dewi.a@example.com",
        role: "",
      });

      const list = await (await call(cookie, "GET", CONTACTS)).json();
      const deleted = await call(cookie, "DELETE", `${CONTACTS}/${id}`);

      expect(replaced.status).toBe(200);
      expect(list.contacts).toEqual([
        { id, name: "Dewi A.", email: "dewi.a@example.com", role: "" },
      ]);
      expect(deleted.status).toBe(204);
    });

    it("stores the address in lower case and rejects a duplicate address", async () => {
      const cookie = await signIn("duplicates@example.com");

      await createContact(cookie, { email: "Same@Example.com" });

      const duplicate = await call(cookie, "POST", CONTACTS, {
        name: "Again",
        email: "same@example.com",
        role: "",
      });

      const list = await (await call(cookie, "GET", CONTACTS)).json();

      expect(duplicate.status).toBe(400);
      expect((await duplicate.json()).fieldErrors).toHaveProperty("email");
      expect(list.contacts.map((contact: { email: string }) => contact.email)).toEqual([
        "same@example.com",
      ]);
    });

    it("allows two users to have a contact with the same address", async () => {
      const first = await signIn("shared-a@example.com");
      const second = await signIn("shared-b@example.com");

      await createContact(first, { email: "shared@example.com" });

      const response = await call(second, "POST", CONTACTS, {
        name: "Shared",
        email: "shared@example.com",
        role: "",
      });

      expect(response.status).toBe(201);
    });

    it("hides the contacts of one user from another user", async () => {
      const owner = await signIn("contact-owner@example.com");
      const intruder = await signIn("contact-intruder@example.com");
      const id = await createContact(owner);

      const list = await (await call(intruder, "GET", CONTACTS)).json();

      const replace = await call(intruder, "PUT", `${CONTACTS}/${id}`, {
        name: "Mallory",
        email: "mallory@example.com",
        role: "",
      });

      const remove = await call(intruder, "DELETE", `${CONTACTS}/${id}`);
      const stillThere = await (await call(owner, "GET", CONTACTS)).json();

      expect(list.contacts).toEqual([]);
      expect([replace.status, remove.status]).toEqual([404, 404]);
      expect(stillThere.contacts).toHaveLength(1);
    });
  });
});
