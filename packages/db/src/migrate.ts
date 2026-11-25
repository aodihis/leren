import { fileURLToPath } from "node:url";

import { migrate } from "drizzle-orm/node-postgres/migrator";

import { createDb } from "./index";

const MIGRATIONS_FOLDER = fileURLToPath(new URL("../drizzle", import.meta.url));

/**
 * Applies the pending migrations to the database that `DATABASE_URL` names, then closes the
 * connection. A production build runs this file as `dist/migrate.js`, so the migration files sit
 * in the `drizzle` directory next to `dist`, at the same relative path as in the source tree.
 */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;

  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }

  const db = createDb(url);

  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await db.$client.end();
  }
}

await main();
