import { getAutoReplyStatus } from "@leren/auto-reply";
import { channelAccounts, playbooks, replyConditions } from "@leren/db";
import type { Db } from "@leren/db";
import { isKnowledgeUsable } from "@leren/knowledge";
import { and, asc, desc, eq, inArray, notInArray, sql } from "drizzle-orm";

import type { PlaybookInput, PlaybookListQuery, ReplyConditionsInput } from "./schema";

type PlaybookRow = typeof playbooks.$inferSelect;

type ConditionsRow = typeof replyConditions.$inferSelect;

export type PlaybookView = ReturnType<typeof toView>;

/** The outcome of changing a playbook. */
export type PlaybookResult = { status: "saved"; playbook: PlaybookView } | { status: "not_found" };

/** Converts stored rows to the API representation. */
function toView(playbook: PlaybookRow, conditions: ConditionsRow[], now: Date) {
  return {
    id: playbook.id,
    topic: playbook.topic,
    examples: playbook.examples,
    response: playbook.response,
    restrictions: playbook.restrictions,
    startsAt: playbook.startsAt?.toISOString() ?? null,
    endsAt: playbook.endsAt?.toISOString() ?? null,
    timezone: playbook.timezone,
    enabled: playbook.enabled,
    periodStatus: getAutoReplyStatus(playbook, now),
    usable: isKnowledgeUsable(playbook, now),
    conditions: conditions
      .toSorted((a, b) => a.channel.localeCompare(b.channel))
      .map(
        (row) =>
          ({
            ...row.settings,
            channel: row.channel,
            channelAccountId: row.channelAccountId,
          }) as ReplyConditionsInput,
      ),
  };
}

/** Splits a request body into rows. */
function toRows(input: PlaybookInput) {
  return {
    playbook: {
      enabled: input.enabled,
      topic: input.topic,
      examples: input.examples,
      response: input.response,
      restrictions: input.restrictions,
      startsAt: input.startsAt ? new Date(input.startsAt) : null,
      endsAt: input.endsAt ? new Date(input.endsAt) : null,
      timezone: input.timezone,
    },
    conditions: input.conditions.map(({ channel, channelAccountId, ...settings }) => ({
      channel,
      channelAccountId: channelAccountId ?? null,
      settings,
    })),
  };
}

/** Thrown when a named channel account is unusable. */
export class ChannelAccountUnavailableError extends Error {
  constructor() {
    super("Choose one of your own connected accounts");
    this.name = "ChannelAccountUnavailableError";
  }
}

/** Thrown when an enabled playbook names no account. */
export class ChannelAccountRequiredError extends Error {
  constructor() {
    super("Choose the account that this playbook answers on, or turn the playbook off");
    this.name = "ChannelAccountRequiredError";
  }
}

/** Checks that named accounts belong to the user. */
async function assertAccountsAvailable(
  tx: Pick<Db, "select">,
  userId: string,
  conditions: { channel: string; channelAccountId: string | null }[],
  rule: { enabled: boolean; requireActive: boolean },
): Promise<void> {
  for (const entry of conditions) {
    if (entry.channelAccountId === null) {
      if (rule.enabled) {
        throw new ChannelAccountRequiredError();
      }

      continue;
    }

    const [account] = await tx
      .select({ id: channelAccounts.id })
      .from(channelAccounts)
      .where(
        and(
          eq(channelAccounts.id, entry.channelAccountId),
          eq(channelAccounts.userId, userId),
          eq(channelAccounts.channel, entry.channel),
          rule.requireActive ? eq(channelAccounts.status, "active") : undefined,
        ),
      )
      .for("key share");

    if (!account) {
      throw new ChannelAccountUnavailableError();
    }
  }
}

/** Lists a user's playbooks, newest first. */
export async function listPlaybooks(
  db: Db,
  userId: string,
  filters: PlaybookListQuery = {},
  now = new Date(),
) {
  const rows = await db
    .select()
    .from(playbooks)
    .where(
      and(
        eq(playbooks.userId, userId),
        filters.enabled ? eq(playbooks.enabled, filters.enabled === "true") : undefined,
      ),
    )
    .orderBy(desc(playbooks.createdAt));

  const conditions =
    rows.length === 0
      ? []
      : await db
          .select()
          .from(replyConditions)
          .where(
            inArray(
              replyConditions.playbookId,
              rows.map((row) => row.id),
            ),
          );

  const views = rows.map((row) =>
    toView(
      row,
      conditions.filter((entry) => entry.playbookId === row.id),
      now,
    ),
  );

  return filters.usable ? views.filter((view) => view.usable) : views;
}

/** Returns one playbook, or null when not found. */
export async function getPlaybook(db: Db, userId: string, id: string, now = new Date()) {
  const [row] = await db
    .select()
    .from(playbooks)
    .where(and(eq(playbooks.id, id), eq(playbooks.userId, userId)));

  if (!row) {
    return null;
  }

  const conditions = await db
    .select()
    .from(replyConditions)
    .where(eq(replyConditions.playbookId, id));

  return toView(row, conditions, now);
}

/** Creates a playbook and its conditions. */
export async function createPlaybook(
  db: Db,
  userId: string,
  input: PlaybookInput,
  now = new Date(),
): Promise<PlaybookView> {
  const { playbook, conditions } = toRows(input);

  return db.transaction(async (tx) => {
    await assertAccountsAvailable(tx, userId, conditions, {
      enabled: playbook.enabled,
      requireActive: playbook.enabled,
    });

    const [created] = await tx
      .insert(playbooks)
      .values({ ...playbook, userId })
      .returning();

    const createdConditions = await tx
      .insert(replyConditions)
      .values(conditions.map((entry) => ({ ...entry, playbookId: created.id })))
      .returning();

    return toView(created, createdConditions, now);
  });
}

/** Replaces a playbook and its conditions. */
export async function updatePlaybook(
  db: Db,
  userId: string,
  id: string,
  input: PlaybookInput,
  now = new Date(),
): Promise<PlaybookResult> {
  const { playbook, conditions } = toRows(input);

  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ enabled: playbooks.enabled })
      .from(playbooks)
      .where(and(eq(playbooks.id, id), eq(playbooks.userId, userId)))
      .for("update");

    if (!current) {
      return { status: "not_found" };
    }

    await assertAccountsAvailable(tx, userId, conditions, {
      enabled: playbook.enabled,
      requireActive: playbook.enabled && !current.enabled,
    });

    const [updated] = await tx
      .update(playbooks)
      .set({ ...playbook, updatedAt: now })
      .where(and(eq(playbooks.id, id), eq(playbooks.userId, userId)))
      .returning();

    if (!updated) {
      return { status: "not_found" };
    }

    await tx.delete(replyConditions).where(
      and(
        eq(replyConditions.playbookId, id),
        notInArray(
          replyConditions.channel,
          conditions.map((entry) => entry.channel),
        ),
      ),
    );

    const updatedConditions = await tx
      .insert(replyConditions)
      .values(conditions.map((entry) => ({ ...entry, playbookId: id })))
      .onConflictDoUpdate({
        target: [replyConditions.playbookId, replyConditions.channel],
        set: {
          settings: sql`excluded.settings`,
          channelAccountId: sql`excluded.channel_account_id`,
          updatedAt: now,
        },
      })
      .returning();

    return { status: "saved", playbook: toView(updated, updatedConditions, now) };
  });
}

/** Turns a playbook on or off. */
export async function setPlaybookEnabled(
  db: Db,
  userId: string,
  id: string,
  enabled: boolean,
  now = new Date(),
): Promise<PlaybookResult> {
  const updated = await db.transaction(async (tx) => {
    const [owned] = await tx
      .select({ id: playbooks.id })
      .from(playbooks)
      .where(and(eq(playbooks.id, id), eq(playbooks.userId, userId)))
      .for("update");

    if (!owned) {
      return false;
    }

    if (enabled) {
      const conditions = await tx
        .select({
          channel: replyConditions.channel,
          channelAccountId: replyConditions.channelAccountId,
        })
        .from(replyConditions)
        .where(eq(replyConditions.playbookId, id));

      await assertAccountsAvailable(tx, userId, conditions, { enabled: true, requireActive: true });
    }

    await tx.update(playbooks).set({ enabled, updatedAt: now }).where(eq(playbooks.id, id));

    return true;
  });

  const view = updated ? await getPlaybook(db, userId, id, now) : null;

  return view ? { status: "saved", playbook: view } : { status: "not_found" };
}

/** A connected account as the assistant sees it. */
export type ActiveAccount = { id: string; label: string };

/** Lists the user's active accounts on a channel. */
export async function listActiveAccounts(
  db: Db,
  userId: string,
  channel: string,
): Promise<ActiveAccount[]> {
  return db
    .select({ id: channelAccounts.id, label: channelAccounts.label })
    .from(channelAccounts)
    .where(
      and(
        eq(channelAccounts.userId, userId),
        eq(channelAccounts.channel, channel),
        eq(channelAccounts.status, "active"),
      ),
    )
    .orderBy(asc(channelAccounts.createdAt));
}

/** Deletes a playbook and its conditions. */
export async function deletePlaybook(db: Db, userId: string, id: string): Promise<boolean> {
  const deleted = await db
    .delete(playbooks)
    .where(and(eq(playbooks.id, id), eq(playbooks.userId, userId)))
    .returning({ id: playbooks.id });

  return deleted.length > 0;
}
