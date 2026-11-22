import { getAutoReplyStatus } from "@leren/auto-reply";
import { channelAccounts, playbooks, replyConditions } from "@leren/db";
import type { Db } from "@leren/db";
import { isKnowledgeUsable } from "@leren/knowledge";
import { and, desc, eq, inArray, notInArray, sql } from "drizzle-orm";

import type { PlaybookInput, PlaybookListQuery, ReplyConditionsInput } from "./schema";

type PlaybookRow = typeof playbooks.$inferSelect;

type ConditionsRow = typeof replyConditions.$inferSelect;

export type PlaybookView = ReturnType<typeof toView>;

/**
 * The outcome of changing a playbook. `not_found` means that the playbook does not exist or belongs
 * to another user.
 */
export type PlaybookResult = { status: "saved"; playbook: PlaybookView } | { status: "not_found" };

/**
 * Converts the stored rows to the representation the API returns. Each conditions row becomes one
 * entry that names its channel. The period status and `usable` are derived from the playbook and
 * `now` and are not stored. The stored settings were validated against the schema of their channel
 * when they were written.
 */
function toView(playbook: PlaybookRow, conditions: ConditionsRow[], now: Date) {
  return {
    id: playbook.id,
    topic: playbook.topic,
    examples: playbook.examples,
    response: playbook.response,
    restrictions: playbook.restrictions,
    contacts: playbook.contacts,
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

/**
 * Removes contacts that repeat an earlier one, ignoring case, and keeps the first spelling.
 */
function dedupeContacts(contacts: string[]): string[] {
  const seen = new Set<string>();

  return contacts.filter((contact) => {
    const key = contact.toLowerCase();
    const isNew = !seen.has(key);

    seen.add(key);

    return isNew;
  });
}

/**
 * Splits a request body into the columns of the playbook and the conditions rows. The channel is a
 * column of its own and is not repeated in the settings.
 */
function toRows(input: PlaybookInput) {
  return {
    playbook: {
      enabled: input.enabled,
      topic: input.topic,
      examples: input.examples,
      response: input.response,
      restrictions: input.restrictions,
      contacts: dedupeContacts(input.contacts),
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

/**
 * Thrown when a playbook names a channel account that does not exist, belongs to another user or
 * is on another channel than the conditions that name it. The write is rolled back.
 */
export class ChannelAccountUnavailableError extends Error {
  constructor() {
    super("The channel account is not available");
    this.name = "ChannelAccountUnavailableError";
  }
}

/**
 * Checks that every channel account named by `conditions` belongs to `userId` and is on the
 * channel of the entry that names it. It runs inside the write's transaction, so a playbook never
 * listens through another user's account. The account row is locked with `FOR KEY SHARE`, so a
 * disconnect waits until the transaction commits and then clears the new reference through the
 * foreign key's `ON DELETE SET NULL`.
 */
async function assertAccountsAvailable(
  tx: Pick<Db, "select">,
  userId: string,
  conditions: { channel: string; channelAccountId: string | null }[],
): Promise<void> {
  for (const entry of conditions) {
    if (entry.channelAccountId === null) {
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
        ),
      )
      .for("key share");

    if (!account) {
      throw new ChannelAccountUnavailableError();
    }
  }
}

/**
 * Lists a user's playbooks, newest first, narrowed by the optional filters. The query is scoped to
 * `userId`. The `usable` filter applies the same rule as retrieval does.
 */
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

/**
 * Returns one playbook, or `null` when it does not exist or belongs to another user. The two cases
 * are indistinguishable, so a caller cannot learn which IDs exist.
 */
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

/**
 * Creates a playbook and its conditions in one transaction, owned by `userId`. Throws
 * `ChannelAccountUnavailableError` when a condition names an account that `userId` may not use.
 */
export async function createPlaybook(
  db: Db,
  userId: string,
  input: PlaybookInput,
  now = new Date(),
): Promise<PlaybookView> {
  const { playbook, conditions } = toRows(input);

  return db.transaction(async (tx) => {
    await assertAccountsAvailable(tx, userId, conditions);

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

/**
 * Replaces a playbook and its conditions, including the account of each channel. A channel that the input leaves out loses its
 * conditions. Returns `not_found` when the playbook does not exist or belongs to another user, in
 * which case nothing is written.
 */
export async function updatePlaybook(
  db: Db,
  userId: string,
  id: string,
  input: PlaybookInput,
  now = new Date(),
): Promise<PlaybookResult> {
  const { playbook, conditions } = toRows(input);

  return db.transaction(async (tx) => {
    await assertAccountsAvailable(tx, userId, conditions);

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

/**
 * Turns a playbook on or off without touching anything else. Returns `not_found` when the playbook
 * does not exist or belongs to another user.
 */
export async function setPlaybookEnabled(
  db: Db,
  userId: string,
  id: string,
  enabled: boolean,
  now = new Date(),
): Promise<PlaybookResult> {
  const [updated] = await db
    .update(playbooks)
    .set({ enabled, updatedAt: now })
    .where(and(eq(playbooks.id, id), eq(playbooks.userId, userId)))
    .returning({ id: playbooks.id });

  const view = updated ? await getPlaybook(db, userId, id, now) : null;

  return view ? { status: "saved", playbook: view } : { status: "not_found" };
}

/**
 * Deletes a playbook and, by cascade, its conditions. Returns whether a playbook owned by `userId`
 * was deleted.
 */
export async function deletePlaybook(db: Db, userId: string, id: string): Promise<boolean> {
  const deleted = await db
    .delete(playbooks)
    .where(and(eq(playbooks.id, id), eq(playbooks.userId, userId)))
    .returning({ id: playbooks.id });

  return deleted.length > 0;
}
