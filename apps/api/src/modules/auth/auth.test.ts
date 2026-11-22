import { users } from "@leren/db";
import { createTestDatabase } from "@leren/db/testing";
import type { TestDatabase } from "@leren/db/testing";
import { createInMemoryEmailSender } from "@leren/email/testing";
import type { InMemoryEmailSender } from "@leren/email/testing";
import type { Logger } from "@leren/logger";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createApp } from "../../app";
import { createAuth, formatDisplayName } from "./service";

const ORIGIN = "http://localhost:5173";

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

describe("formatDisplayName", () => {
  it("joins the first and last name", () => {
    expect(formatDisplayName(" Ada ", "Lovelace")).toBe("Ada Lovelace");
  });

  it("skips missing parts", () => {
    expect(formatDisplayName("Ada", null)).toBe("Ada");
    expect(formatDisplayName(undefined, undefined)).toBe("");
  });
});

describe("email code authentication", () => {
  let database: TestDatabase;
  let sender: InMemoryEmailSender;
  let app: ReturnType<typeof createApp>;

  const post = (path: string, body: unknown, cookie = "") =>
    app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN, cookie },
      body: JSON.stringify(body),
    });

  const signIn = async (email: string) => {
    const sendResponse = await post("/api/auth/email-otp/send-verification-otp", {
      email,
      type: "sign-in",
    });

    expect(sendResponse.status).toBe(200);

    const code = /\b\d{6}\b/.exec(sender.sent.at(-1)?.text ?? "")?.[0];
    const response = await post("/api/auth/sign-in/email-otp", { email, otp: code });

    const cookie = response.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");

    return { response, cookie };
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
      requestKnowledgeIndex: vi.fn(),
      mcp: { secret: MCP_SECRET },
    });
  });

  afterAll(async () => {
    await database.drop();
  });

  it("emails a code to the address", async () => {
    await post("/api/auth/email-otp/send-verification-otp", {
      email: "mail@example.com",
      type: "sign-in",
    });

    expect(sender.sent.at(-1)?.to).toBe("mail@example.com");
  });

  it("registers an unknown address when its code is verified", async () => {
    const { response, cookie } = await signIn("new@example.com");
    const me = await app.request("/api/me", { headers: { cookie } });

    expect(response.status).toBe(200);
    expect(await me.json()).toMatchObject({ user: { email: "new@example.com" } });
  });

  it("rejects a wrong code", async () => {
    await post("/api/auth/email-otp/send-verification-otp", {
      email: "wrong@example.com",
      type: "sign-in",
    });

    const response = await post("/api/auth/sign-in/email-otp", {
      email: "wrong@example.com",
      otp: "000000",
    });

    expect(response.status).toBe(400);
  });

  it("rejects /api/me without a session", async () => {
    const response = await app.request("/api/me");

    expect(response.status).toBe(401);
  });

  it("stores the first and last name and derives the display name", async () => {
    const { cookie } = await signIn("named@example.com");

    const update = await post(
      "/api/auth/update-user",
      { firstName: "Ada", lastName: "Lovelace" },
      cookie,
    );

    const me = await app.request("/api/me", { headers: { cookie } });

    expect(update.status).toBe(200);
    expect(await me.json()).toMatchObject({ user: { firstName: "Ada", lastName: "Lovelace" } });
  });

  it("keeps the stored last name when only the first name changes", async () => {
    const { cookie } = await signIn("partial@example.com");

    await post("/api/auth/update-user", { firstName: "Ada", lastName: "Lovelace" }, cookie);
    await post("/api/auth/update-user", { firstName: "Augusta" }, cookie);

    const [row] = await database.db
      .select()
      .from(users)
      .where(eq(users.email, "partial@example.com"));

    expect(row?.name).toBe("Augusta Lovelace");
  });

  it("updates the profile through PATCH /api/me", async () => {
    const { cookie } = await signIn("patch@example.com");

    const response = await app.request("/api/me", {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ firstName: "Grace", lastName: "Hopper" }),
    });

    const [row] = await database.db
      .select()
      .from(users)
      .where(eq(users.email, "patch@example.com"));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      user: { firstName: "Grace", lastName: "Hopper" },
    });
    expect(row?.name).toBe("Grace Hopper");
  });

  it("rejects an invalid profile with field errors", async () => {
    const { cookie } = await signIn("invalid@example.com");

    const response = await app.request("/api/me", {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ firstName: " ", lastName: "Hopper" }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      fieldErrors: { firstName: ["Enter your first name"] },
    });
  });

  it("does not let a signed-out request update a profile", async () => {
    const response = await app.request("/api/me", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ firstName: "A", lastName: "B" }),
    });

    expect(response.status).toBe(401);
  });

  it("returns each user only their own profile", async () => {
    const userA = await signIn("a@example.com");
    const userB = await signIn("b@example.com");

    const profileA = await app.request("/api/me", { headers: { cookie: userA.cookie } });
    const profileB = await app.request("/api/me", { headers: { cookie: userB.cookie } });

    expect(await profileA.json()).toMatchObject({ user: { email: "a@example.com" } });
    expect(await profileB.json()).toMatchObject({ user: { email: "b@example.com" } });
  });
});
