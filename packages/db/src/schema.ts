import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Application users. Placeholder table that proves the database setup works.
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
