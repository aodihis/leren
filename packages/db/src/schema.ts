import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Application users, following Better Auth's `user` model with `firstName` and `lastName` added.
 * Users sign in with an emailed code and have no password. `name` stays empty until a profile is
 * saved. `replyInstruction` is the default instruction for replies, empty when unset (decision
 * 0051).
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  name: text("name").notNull().default(""),
  firstName: text("first_name"),
  lastName: text("last_name"),
  image: text("image"),
  replyInstruction: text("reply_instruction").notNull().default(""),
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
 * Playbooks: each row is one topic that says when the assistant replies and what it says.
 * `instruction` applies together with the user's default instruction (decision 0051). A null period
 * bound is open. Whether a playbook is usable is derived from `enabled` and the period and never
 * stored (decision 0036).
 */
export const playbooks = pgTable(
  "playbooks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    topic: text("topic").notNull(),
    information: text("information").notNull(),
    instruction: text("instruction").notNull().default(""),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    timezone: text("timezone").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [index("playbooks_user_id_idx").on(table.userId)],
);

export const channelAccountStatusEnum = pgEnum("channel_account_status", ["active", "revoked"]);

/**
 * A user's authorised account on a channel, such as one Gmail mailbox. `providerAccountId` is the
 * provider's stable identifier, so an account belongs to exactly one user. `credentials` is
 * encrypted. `syncCursor` is opaque outside its provider (decision 0041). Disabling a provider in
 * the configuration changes no row (decision 0038).
 */
export const channelAccounts = pgTable(
  "channel_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    channel: text("channel").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    label: text("label").notNull(),
    credentials: text("credentials"),
    status: channelAccountStatusEnum("status").notNull().default("active"),
    syncCursor: text("sync_cursor"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    unique("channel_accounts_provider_account_unique").on(
      table.channel,
      table.provider,
      table.providerAccountId,
    ),
    index("channel_accounts_user_id_idx").on(table.userId),
  ],
);

export const connectorStatusEnum = pgEnum("connector_status", ["active", "revoked"]);

/**
 * A user's authorisation of an external MCP server, such as one Notion workspace (decision 0054).
 * `connector` names a definition in `@leren/connectors`. `credentials` is encrypted text with the
 * same format as `channel_accounts.credentials`. A user has at most one row for each connector.
 */
export const connectors = pgTable(
  "connectors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    connector: text("connector").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    label: text("label").notNull(),
    credentials: text("credentials"),
    status: connectorStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [unique("connectors_user_connector_unique").on(table.userId, table.connector)],
);

/**
 * The reply conditions of a playbook for one channel, at most one row per channel. `channel` is
 * text, so a new channel needs no migration. `settings` is defined and validated per channel by the
 * API and `@leren/auto-reply`, which keeps `playbooks` channel-agnostic.
 */
export const replyConditions = pgTable(
  "reply_conditions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    playbookId: uuid("playbook_id")
      .notNull()
      .references(() => playbooks.id, { onDelete: "cascade" }),
    channel: text("channel").notNull(),
    channelAccountId: uuid("channel_account_id").references(() => channelAccounts.id, {
      onDelete: "set null",
    }),
    settings: jsonb("settings").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    unique("reply_conditions_playbook_channel_unique").on(table.playbookId, table.channel),
  ],
);

export const messageStatusEnum = pgEnum("message_status", [
  "received",
  "not_applicable",
  "queued",
  "processing",
  "drafted",
  "sent",
  "escalated",
  "failed",
]);

/**
 * The record of one received message and where it stands in the pipeline (decision 0039). The body
 * is cut to a fixed length, and `bodyTruncated` says when. A message is unique on the user,
 * channel, provider and `providerMessageId`, so recording is idempotent. `status` only moves
 * forward.
 */
export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    channelAccountId: uuid("channel_account_id").references(() => channelAccounts.id, {
      onDelete: "set null",
    }),
    channel: text("channel").notNull(),
    provider: text("provider").notNull(),
    providerMessageId: text("provider_message_id").notNull(),
    providerThreadId: text("provider_thread_id"),
    fromAddress: text("from_address").notNull(),
    toAddresses: text("to_addresses").array().notNull().default([]),
    ccAddresses: text("cc_addresses").array().notNull().default([]),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    bodyTruncated: boolean("body_truncated").notNull().default(false),
    isReply: boolean("is_reply").notNull().default(false),
    isBulk: boolean("is_bulk").notNull().default(false),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    status: messageStatusEnum("status").notNull().default("received"),
    statusReason: text("status_reason"),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    unique("messages_provider_message_unique").on(
      table.userId,
      table.channel,
      table.provider,
      table.providerMessageId,
    ),
    index("messages_user_received_idx").on(table.userId, table.receivedAt),
  ],
);

/**
 * How the reply pipeline ended for one message (decision 0043): a reply to approve, a message that
 * the user must handle, or a message that is not for the user.
 */
export const replyOutcomeEnum = pgEnum("reply_outcome", ["answer", "escalate", "ignore"]);

/**
 * How a reply is delivered (decision 0046): as a draft in the user's mailbox, or sent at once.
 */
export const deliveryModeEnum = pgEnum("delivery_mode", ["draft", "send"]);

/**
 * How far the delivery of a reply got (decision 0046): `pending` is queued, `started` has called or
 * is about to call the provider without an answer, `completed` has the provider's id stored, and
 * `failed` ended with an error.
 */
export const deliveryStateEnum = pgEnum("delivery_state", [
  "pending",
  "started",
  "completed",
  "failed",
]);

/**
 * The result of the reply pipeline, at most one row per message (decision 0043). `body` is set only
 * for the `answer` outcome. The `delivery*` columns record delivering the reply (decision 0046).
 * `deliveryRequest` is written before the provider is called, and check constraints keep the
 * delivery record complete for each state.
 */
export const replyDecisions = pgTable(
  "reply_decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    messageId: uuid("message_id")
      .notNull()
      .unique()
      .references(() => messages.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    outcome: replyOutcomeEnum("outcome").notNull(),
    body: text("body"),
    category: text("category"),
    citations: text("citations").array().notNull().default([]),
    playbookIds: text("playbook_ids").array().notNull().default([]),
    reasons: text("reasons").array().notNull().default([]),
    revisions: integer("revisions").notNull().default(0),
    evaluations: jsonb("evaluations").notNull().default([]),
    deliveryMode: deliveryModeEnum("delivery_mode"),
    deliveryState: deliveryStateEnum("delivery_state"),
    deliveryRequest: jsonb("delivery_request"),
    deliveryResponse: jsonb("delivery_response"),
    deliveryAttempts: integer("delivery_attempts").notNull().default(0),
    deliveryStartedAt: timestamp("delivery_started_at", { withTimezone: true }),
    deliveryFinishedAt: timestamp("delivery_finished_at", { withTimezone: true }),
    mailboxDraftId: text("mailbox_draft_id"),
    sentMessageId: text("sent_message_id"),
    deliveryError: text("delivery_error"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    check(
      "reply_decisions_delivery_state_has_mode",
      sql`${table.deliveryState} IS NULL OR ${table.deliveryMode} IS NOT NULL`,
    ),
    check(
      "reply_decisions_delivery_started_has_request",
      sql`${table.deliveryState} IS NULL OR ${table.deliveryState} NOT IN ('started', 'completed') OR (${table.deliveryRequest} IS NOT NULL AND ${table.deliveryStartedAt} IS NOT NULL)`,
    ),
    check(
      "reply_decisions_delivery_completed_has_id",
      sql`${table.deliveryState} IS DISTINCT FROM 'completed' OR ${table.mailboxDraftId} IS NOT NULL OR ${table.sentMessageId} IS NOT NULL`,
    ),
  ],
);

export const mcpClientRoleEnum = pgEnum("mcp_client_role", ["assistant", "reply"]);

/**
 * MCP sessions. The id is the signed token's `jti`, so a token is valid only while its row exists
 * and is neither expired nor revoked. A reply session can read only the `playbookIds` that the gate
 * allowed for `messageId`. `name` is set only for access tokens that the user created.
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
    playbookIds: uuid("playbook_ids").array(),
    name: text("name"),
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

/**
 * The tables of Anvia's Drizzle memory store, which holds the Assistant Agent's conversation
 * history. They are generated by `anvia-memory-drizzle init` and migrated with the rest.
 */
export {
  agentMemoryErrors,
  agentMemoryMessages,
  agentMemorySessions,
  agentMemoryWrites,
} from "@anvia/memory-drizzle";
