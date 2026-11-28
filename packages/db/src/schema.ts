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
 * Application users. The shape follows Better Auth's `user` model, with `firstName` and
 * `lastName` as additional fields. Users sign in with an emailed code and have no password.
 * `name` is the display name Better Auth requires and stays empty until a profile is saved.
 * `replyInstruction` is the default instruction for how replies are written. It is empty when the
 * user has not set one (decision 0051).
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
 * Playbooks. A playbook says when the assistant replies and what it says, one topic for each row.
 * `information` is what the assistant knows about the topic, and retrieval finds the playbook by
 * its topic and its information. `instruction` says how to answer when the playbook is used and
 * applies together with the default instruction of the user. It is empty when the playbook has none (decision
 * 0051). Whom a sender may contact is written in `information`. `startsAt` and `endsAt` are
 * instants and a null bound is open. `timezone` is the IANA zone the user enters and reads the bounds in. A playbook
 * is usable only when it is `enabled` and the current time is inside its period, and the period
 * status is derived and never stored (decision 0036). The channel conditions of a playbook are
 * rows of `reply_conditions`.
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
 * A user's authorised account on a channel, such as one Gmail mailbox. `provider` names the adapter
 * that connected it and `providerAccountId` is the provider's stable identifier of the account, so
 * an account belongs to exactly one user. `label` is the text shown to the user, such as the
 * address. `credentials` is the encrypted token set, and it is null for a provider that has none.
 * `syncCursor` is the opaque position from which the listener reads new mail. Only the provider that
 * wrote it interprets it. Connecting sets it to the position of the mailbox at that moment, and it
 * is null only when the provider could not read that position, so the first poll sets it
 * (decision 0041).
 * Whether an account is usable also depends on its provider being enabled in the configuration, so
 * disabling a provider changes no row (decision 0038).
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
 * The reply conditions of a playbook for one channel, such as `email` or `slack`. A playbook
 * listens on a channel when it has a row for that channel, and it has at most one row for each.
 * `channel` is text and not an enum so that a new channel needs no migration. `settings` holds the
 * conditions of that channel, whose shape is defined and validated per channel by the API and
 * `@leren/auto-reply`. Keeping them here keeps `playbooks` channel-agnostic.
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
 * The record of one received message and where it stands in the pipeline (decision 0039). It holds
 * only the email data: the sender, the recipients, the subject and a body that is cut to a fixed
 * length, with `bodyTruncated` set when it was cut. `providerMessageId` and `providerThreadId` are
 * the provider's own identifiers, and a message is unique on the user, the channel, the provider
 * and `providerMessageId`, which makes recording it idempotent. `channelAccountId` is set to null
 * when the account is deleted, and the record stays. `status` moves forward through the pipeline
 * and `statusReason` is a short code that says why.
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
 * How far the delivery of a reply got (decision 0046). `pending` means that it is queued, `started`
 * that the deliverer is about to call the provider or has called it and has no answer, `completed`
 * that the provider answered and its id is stored, and `failed` that it ended with an error.
 */
export const deliveryStateEnum = pgEnum("delivery_state", [
  "pending",
  "started",
  "completed",
  "failed",
]);

/**
 * The result of the reply pipeline for one message, at most one row for each message (decision
 * 0043). `body` is the draft when the outcome is `answer` and is null otherwise.
 * `citations` are the ids of the playbooks that the draft cites, `playbookIds` are all the playbooks
 * that the run used, `reasons` say why the pipeline ended as it did, and `evaluations` keeps what
 * the evaluator found for each draft. The rows go with their message and their user.
 *
 * The `delivery*` columns, `mailboxDraftId` and `sentMessageId` are the record of delivering the
 * reply (decision 0046). They are empty until a delivery is queued. `deliveryRequest` is written
 * before the provider is called and holds the exact reply, and `deliveryResponse` holds the whole
 * answer of the provider, so that a delivery that lost its answer can be investigated afterwards.
 * Three checks keep that record whole: a delivery that has a state has a mode, a delivery that
 * started or completed has the request and the time it started, and a completed delivery has the id
 * that the provider returned.
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
 * MCP sessions. The id is the `jti` of the signed token, so a token is valid only while its row
 * exists, has not expired and is not revoked. `scopes` is the set granted at minting time and
 * `messageId` and `playbookIds` are set only for a reply session: `playbookIds` holds the playbooks
 * that the email gate allowed for that message, and the session can read no other playbook. `name`
 * is set only for an access token that the user created in the dashboard, and is null for the
 * short-lived sessions that the built-in agents open. A session is removed with its user.
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
