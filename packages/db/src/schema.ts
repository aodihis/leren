import {
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

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

/**
 * The reply conditions of an auto-reply rule for one channel, such as `email` or `slack`. A rule
 * listens on a channel when it has a row for that channel, and it has at most one row for each.
 * `channel` is text and not an enum so that a new channel needs no migration. `settings` holds the
 * conditions of that channel, whose shape is defined and validated per channel by the API and
 * `@leren/auto-reply`. Keeping them here keeps `auto_reply_rules` channel-agnostic.
 */
export const replyConditions = pgTable(
  "reply_conditions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ruleId: uuid("rule_id")
      .notNull()
      .references(() => autoReplyRules.id, { onDelete: "cascade" }),
    channel: text("channel").notNull(),
    settings: jsonb("settings").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [unique("reply_conditions_rule_channel_unique").on(table.ruleId, table.channel)],
);

export const approvalStatusEnum = pgEnum("approval_status", ["draft", "approved", "archived"]);

/**
 * Knowledge that the assistant may use while an auto-reply rule is in effect, one topic for each
 * row. `response` is what the assistant may say about the topic and `restrictions` is what it must
 * not say. `examples` are optional sample messages that help retrieval find the item, and
 * `contacts` lists the people a reply may point to, as email addresses or channel handles.
 * `validFrom` and `validUntil` are instants and a null bound is open. An item is usable only when
 * it is `approved` and the current time is inside its window. `userId` repeats the owner of the
 * rule so that every query can filter by user without a join.
 */
export const knowledgeItems = pgTable(
  "knowledge_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ruleId: uuid("rule_id")
      .notNull()
      .references(() => autoReplyRules.id, { onDelete: "cascade" }),
    topic: text("topic").notNull(),
    examples: text("examples").array().notNull().default([]),
    response: text("response").notNull(),
    restrictions: text("restrictions").notNull().default(""),
    contacts: text("contacts").array().notNull().default([]),
    validFrom: timestamp("valid_from", { withTimezone: true }),
    validUntil: timestamp("valid_until", { withTimezone: true }),
    approvalStatus: approvalStatusEnum("approval_status").notNull().default("draft"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("knowledge_items_user_id_idx").on(table.userId),
    index("knowledge_items_rule_id_idx").on(table.ruleId),
  ],
);

export const mcpClientRoleEnum = pgEnum("mcp_client_role", ["assistant", "reply"]);

/**
 * MCP sessions. The id is the `jti` of the signed token, so a token is valid only while its row
 * exists, has not expired and is not revoked. `scopes` is the set granted at minting time and
 * `messageId` is set only for a reply session. A session is removed with its user.
 */
export const mcpSessions = pgTable(
  "mcp_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: mcpClientRoleEnum("role").notNull(),
    scopes: text("scopes").array().notNull(),
    messageId: text("message_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [index("mcp_sessions_user_id_idx").on(table.userId)],
);

/**
 * One row for each MCP tool call. `summary` holds the redacted arguments and never a token or a
 * knowledge body. `sessionId` is not a foreign key, so the log outlives its session.
 */
export const mcpAuditLog = pgTable(
  "mcp_audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").notNull(),
    tool: text("tool").notNull(),
    outcome: text("outcome").notNull(),
    summary: jsonb("summary").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [index("mcp_audit_log_user_id_idx").on(table.userId)],
);
