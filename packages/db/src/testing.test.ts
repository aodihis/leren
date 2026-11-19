import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { users } from "./schema";
import { createTestDatabase } from "./testing";
import type { TestDatabase } from "./testing";

describe("createTestDatabase", () => {
  let first: TestDatabase;
  let second: TestDatabase;

  beforeAll(async () => {
    first = await createTestDatabase();
    second = await createTestDatabase();
  });

  afterAll(async () => {
    await first.drop();
    await second.drop();
  });

  it("applies the migrations", async () => {
    const [user] = await first.db.insert(users).values({ email: "a@example.com" }).returning();

    expect(user?.email).toBe("a@example.com");
  });

  it("gives each call an isolated database", async () => {
    await second.db.insert(users).values({ email: "b@example.com" });

    const rows = await first.db.select().from(users);

    expect(rows.map((row) => row.email)).not.toContain("b@example.com");
    expect(first.connectionString).not.toBe(second.connectionString);
  });
});
