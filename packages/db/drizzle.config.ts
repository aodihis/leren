import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit configuration. Reads the connection string from `DATABASE_URL`.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://leren:leren@localhost:54329/leren",
  },
});
