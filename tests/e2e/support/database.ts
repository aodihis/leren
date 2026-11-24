import { fileURLToPath } from "node:url";

import { createDb } from "@leren/db";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";

import { ADMIN_DATABASE_URL, E2E_DATABASE_NAME } from "./config";

const MIGRATIONS_FOLDER = fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url));

/** Returns the end-to-end database connection string. */
export function getE2eDatabaseUrl(): string {
  const url = new URL(ADMIN_DATABASE_URL);

  url.pathname = `/${E2E_DATABASE_NAME}`;

  return url.toString();
}

/** Recreates the end-to-end database and migrates it. */
export async function resetE2eDatabase(): Promise<void> {
  const admin = new Client({ connectionString: ADMIN_DATABASE_URL });

  await admin.connect();

  try {
    await admin.query(`DROP DATABASE IF EXISTS "${E2E_DATABASE_NAME}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${E2E_DATABASE_NAME}"`);
  } finally {
    await admin.end();
  }

  const db = createDb(getE2eDatabaseUrl());

  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await db.$client.end();
  }
}
