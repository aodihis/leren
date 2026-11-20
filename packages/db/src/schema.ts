import {
  boolean,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
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

/**
 * People that the assistant may name in a reply, such as the person to contact about a topic. A
 * contact belongs to one user and is unique by address within that user. `role` is a free-text
 * label such as "Project lead".
 */
export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    email: text("email").notNull(),
    role: text("role").notNull().default(""),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [uniqueIndex("contacts_user_id_email_idx").on(table.userId, table.email)],
);

export const approvalStatusEnum = pgEnum("approval_status", ["draft", "approved", "archived"]);

/**
 * What the assistant may say about a topic while an auto-reply rule is in effect. Only an
 * `approved` item whose validity window contains the current time is usable. `validFrom` and
 * `validUntil` are instants and a null bound is open. `examples` are optional sample messages, in any
 * phrasing, that help retrieval find the item. `response` is what the assistant may say, and
 * `restrictions` states what must not be said. `userId` repeats the
 * owner of the rule so that every query can filter by user without a join.
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

/**
 * The contacts attached to a knowledge item. Deleting either side removes the link.
 */
export const knowledgeItemContacts = pgTable(
  "knowledge_item_contacts",
  {
    knowledgeItemId: uuid("knowledge_item_id")
      .notNull()
      .references(() => knowledgeItems.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.knowledgeItemId, table.contactId] })],
);
