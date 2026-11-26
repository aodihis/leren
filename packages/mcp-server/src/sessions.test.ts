import { mcpSessions, users } from "@leren/db";
import { createTestDatabase } from "@leren/db/testing";
import type { TestDatabase } from "@leren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { mintSession, revokeSession, verifySession } from "./sessions";
import type { SessionDependencies } from "./sessions";

const SECRET = "a-test-secret-that-is-at-least-32-characters";
const START = new Date("2026-06-15T12:00:00Z");

describe("MCP sessions", () => {
  let database: TestDatabase;
  let userId: string;
  let otherUserId: string;
  let clock: Date;
  let deps: SessionDependencies;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database.drop();
  });

  beforeEach(async () => {
    await database.db.delete(users);

    const [user, other] = await database.db
      .insert(users)
      .values([{ email: "a@example.com" }, { email: "b@example.com" }])
      .returning({ id: users.id });

    userId = user.id;
    otherUserId = other.id;
    clock = START;
    deps = { db: database.db, secret: SECRET, now: () => clock };
  });

  it("verifies a freshly minted token and returns the stored session", async () => {
    const minted = await mintSession(deps, { userId, role: "assistant" });
    const session = await verifySession(deps, minted.token);

    expect(session).toEqual({
      id: minted.sessionId,
      userId,
      role: "assistant",
      scopes: ["playbooks:read", "playbooks:write", "messages:read"],
      messageId: null,
      name: null,
    });
  });

  it("returns the name of an access token", async () => {
    const minted = await mintSession(deps, { userId, role: "assistant", name: "Cursor" });

    expect((await verifySession(deps, minted.token))?.name).toBe("Cursor");
  });

  it("grants only the requested scopes", async () => {
    const minted = await mintSession(deps, {
      userId,
      role: "assistant",
      scopes: ["playbooks:read"],
    });

    expect((await verifySession(deps, minted.token))?.scopes).toEqual(["playbooks:read"]);
  });

  it("refuses a scope outside the role", async () => {
    await expect(
      mintSession(deps, { userId, role: "reply", messageId: "m1", scopes: ["playbooks:write"] }),
    ).rejects.toThrow("not allowed");
  });

  it("requires a message id for the reply role and rejects one for the assistant", async () => {
    await expect(mintSession(deps, { userId, role: "reply" })).rejects.toThrow("message id");
    await expect(mintSession(deps, { userId, role: "assistant", messageId: "m1" })).rejects.toThrow(
      "message id",
    );

    const minted = await mintSession(deps, { userId, role: "reply", messageId: "m1" });

    expect((await verifySession(deps, minted.token))?.messageId).toBe("m1");
  });

  it("rejects a short signing secret", async () => {
    await expect(
      mintSession({ ...deps, secret: "short" }, { userId, role: "assistant" }),
    ).rejects.toThrow("at least 32");
  });

  it("rejects an expired token", async () => {
    const minted = await mintSession(deps, { userId, role: "assistant", ttlSeconds: 60 });

    clock = new Date(START.getTime() + 61_000);

    expect(await verifySession(deps, minted.token)).toBeNull();
  });

  it("rejects a token after the session is revoked, so replaying it fails", async () => {
    const minted = await mintSession(deps, { userId, role: "assistant" });

    expect(await revokeSession(deps, userId, minted.sessionId)).toBe(true);
    expect(await verifySession(deps, minted.token)).toBeNull();
    expect(await revokeSession(deps, userId, minted.sessionId)).toBe(false);
  });

  it("does not let a user revoke the session of another user", async () => {
    const minted = await mintSession(deps, { userId, role: "assistant" });

    expect(await revokeSession(deps, otherUserId, minted.sessionId)).toBe(false);
    expect(await verifySession(deps, minted.token)).not.toBeNull();
  });

  it("rejects a token signed with another secret, a tampered token and garbage", async () => {
    const minted = await mintSession(deps, { userId, role: "assistant" });

    const foreign = await verifySession(
      { ...deps, secret: "another-secret-that-is-at-least-32-chars" },
      minted.token,
    );

    expect(foreign).toBeNull();
    expect(await verifySession(deps, `${minted.token}x`)).toBeNull();
    expect(await verifySession(deps, "not-a-token")).toBeNull();
  });

  it("rejects a token whose session row is gone or belongs to another user", async () => {
    const minted = await mintSession(deps, { userId, role: "assistant" });

    await database.db
      .update(mcpSessions)
      .set({ userId: otherUserId })
      .where(eq(mcpSessions.id, minted.sessionId));

    expect(await verifySession(deps, minted.token)).toBeNull();

    await database.db.delete(mcpSessions).where(eq(mcpSessions.id, minted.sessionId));

    expect(await verifySession(deps, minted.token)).toBeNull();
  });

  it("uses the scopes of the row and rejects a token that claims more", async () => {
    const minted = await mintSession(deps, { userId, role: "assistant" });

    await database.db
      .update(mcpSessions)
      .set({ scopes: ["playbooks:read"] })
      .where(eq(mcpSessions.id, minted.sessionId));

    expect(await verifySession(deps, minted.token)).toBeNull();
  });
});
