import { defineConfig } from "drizzle-kit";

/** The Drizzle Kit configuration. */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://leren:leren@localhost:54329/leren",
  },
});
