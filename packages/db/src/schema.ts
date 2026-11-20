import { boolean, index, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Application users. The shape follows Better Auth's `user` model, with `firstName` and
 * `lastName` as additional fields. Users sign in with an emailed code and have no password.
 * `name` is the display name Better Auth requires and stays empty until a profile is saved.
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  name: text("name").notNull().default(""),
  firstName: text("first_name"),
  lastName: text("last_name"),
  image: text("image"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/**
 * Browser sessions. A session is created when a user enters a valid sign-in code and is removed
 * with its user.
 */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [index("sessions_user_id_idx").on(table.userId)],
);

/**
 * Sign-in methods linked to a user. Email code sign-in does not create rows here. The table exists
 * because Better Auth's data model requires it for other providers.
 */
export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [index("accounts_user_id_idx").on(table.userId)],
);

/**
 * Pending sign-in codes. `identifier` is the code's purpose and the email address, and `value`
 * holds the code and its attempt count.
 */
export const verifications = pgTable(
  "verifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [index("verifications_identifier_idx").on(table.identifier)],
);

/**
 * Auto-reply rules. A rule says when the assistant is active for a user. Its status is derived from
 * `enabled`, `startsAt`, `endsAt` and the current time, so it is never stored (decision 0019).
 * `startsAt` and `endsAt` are instants and a null bound is open. `timezone` is the IANA zone the
 * user enters and reads the bounds in. `name` is a label shown in the rule list and is never read
 * by the gate.
 */
export const autoReplyRules = pgTable(
  "auto_reply_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    timezone: text("timezone").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [index("auto_reply_rules_user_id_idx").on(table.userId)],
);

export const senderModeEnum = pgEnum("sender_mode", ["any", "allowlist"]);
export const mentionDetectionEnum = pgEnum("mention_detection", ["alias", "alias_then_llm"]);
export const threadModeEnum = pgEnum("thread_mode", ["new", "reply", "both"]);

/**
 * The email conditions of an auto-reply rule, one row per rule. Conditions of another channel
 * belong in a table of their own so that `auto_reply_rules` stays channel-agnostic. A sender
 * allowlist holds full addresses and `@domain` entries. `mentionAliases` extends the user's own
 * names when detecting a mention of the user in the message.
 */
export const emailReplyConditions = pgTable("email_reply_conditions", {
  id: uuid("id").primaryKey().defaultRandom(),
  ruleId: uuid("rule_id")
    .notNull()
    .unique()
    .references(() => autoReplyRules.id, { onDelete: "cascade" }),
  senderMode: senderModeEnum("sender_mode").notNull().default("any"),
  senderAllowlist: text("sender_allowlist").array().notNull().default([]),
  replyWhenTo: boolean("reply_when_to").notNull().default(true),
  replyWhenCc: boolean("reply_when_cc").notNull().default(false),
  replyWhenBcc: boolean("reply_when_bcc").notNull().default(false),
  requireSoleRecipient: boolean("require_sole_recipient").notNull().default(false),
  mentionOverrides: boolean("mention_overrides").notNull().default(false),
  mentionDetection: mentionDetectionEnum("mention_detection").notNull().default("alias"),
  mentionAliases: text("mention_aliases").array().notNull().default([]),
  threadMode: threadModeEnum("thread_mode").notNull().default("both"),
  skipBulkMail: boolean("skip_bulk_mail").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
