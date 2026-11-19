import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";

import { createDb } from "./index";
import type { Db } from "./index";

const DEFAULT_CONNECTION_STRING = "postgres://leren:leren@localhost:54329/leren";
const MIGRATIONS_FOLDER = fileURLToPath(new URL("../drizzle", import.meta.url));

export type TestDatabase = {
  db: Db;
  connectionString: string;
  drop(): Promise<void>;
};

/**
 * Creates an empty PostgreSQL database with every migration applied, for integration tests.
 *
 * The database is created on the server named by `baseConnectionString`, which defaults to
 * `DATABASE_URL`. Each call gets its own uniquely named database, so test files can run in
 * parallel without sharing rows. The caller must call `drop` when it is done, which closes the
 * connection pool and removes the database. The generated name is hexadecimal, so it is safe to
 * use as a quoted identifier.
 */
export async function createTestDatabase(
  baseConnectionString = process.env.DATABASE_URL ?? DEFAULT_CONNECTION_STRING,
): Promise<TestDatabase> {
  const name = `leren_test_${randomUUID().replaceAll("-", "")}`;
  const url = new URL(baseConnectionString);

  url.pathname = `/${name}`;

  await runAdminQuery(baseConnectionString, `CREATE DATABASE "${name}"`);

  const connectionString = url.toString();
  const db = createDb(connectionString);

  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  } catch (error) {
    await dropDatabase(db, baseConnectionString, name);
    throw error;
  }

  return {
    db,
    connectionString,
    drop: () => dropDatabase(db, baseConnectionString, name),
  };
}

async function dropDatabase(db: Db, baseConnectionString: string, name: string): Promise<void> {
  await db.$client.end();
  await runAdminQuery(baseConnectionString, `DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
}

async function runAdminQuery(connectionString: string, query: string): Promise<void> {
  const admin = new Client({ connectionString });

  await admin.connect();

  try {
    await admin.query(query);
  } finally {
    await admin.end();
  }
}
