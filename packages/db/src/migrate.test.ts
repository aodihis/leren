import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  migrate: vi.fn(),
  end: vi.fn(),
  createDb: vi.fn(),
}));

vi.mock("drizzle-orm/node-postgres/migrator", () => ({ migrate: mocks.migrate }));

vi.mock("./index", () => ({ createDb: mocks.createDb }));

/** Runs the migration entry point, as `pnpm db:migrate` does. */
async function runMigrations() {
  vi.resetModules();
  await import("./migrate");
}

describe("migrate entry point", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createDb.mockReturnValue({ $client: { end: mocks.end } });
    mocks.migrate.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("applies the migrations of the drizzle directory and closes the connection", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://db");

    await runMigrations();

    expect(mocks.createDb).toHaveBeenCalledWith("postgres://db");
    expect(mocks.migrate).toHaveBeenCalledWith(expect.anything(), {
      migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
    });
    expect(mocks.end).toHaveBeenCalledOnce();
  });

  it("closes the connection when a migration fails", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://db");
    mocks.migrate.mockRejectedValue(new Error("bad migration"));

    await expect(runMigrations()).rejects.toThrow("bad migration");
    expect(mocks.end).toHaveBeenCalledOnce();
  });

  it("refuses to run without DATABASE_URL", async () => {
    vi.stubEnv("DATABASE_URL", "");

    await expect(runMigrations()).rejects.toThrow("DATABASE_URL is not set");
    expect(mocks.createDb).not.toHaveBeenCalled();
  });
});
