import { getAutoReplyStatus } from "@leren/auto-reply";
import { playbooks, replyConditions } from "@leren/db";
import type { Db } from "@leren/db";
import { isKnowledgeUsable } from "@leren/knowledge";
import { and, desc, eq, inArray, notInArray, sql } from "drizzle-orm";

import type { PlaybookInput, PlaybookListQuery, ReplyConditionsInput } from "./schema";

type PlaybookRow = typeof playbooks.$inferSelect;

type ConditionsRow = typeof replyConditions.$inferSelect;

export type PlaybookView = ReturnType<typeof toView>;

/**
 * The approval actions. Each action lists the statuses it applies to and the status it leads to.
 * Restoring leads to draft and not to approved, so that a restored playbook is reviewed again.
 */
const TRANSITIONS = {
  approve: { from: ["draft"], to: "approved" },
  archive: { from: ["draft", "approved"], to: "archived" },
  restore: { from: ["archived"], to: "draft" },
} as const;

export type PlaybookTransition = keyof typeof TRANSITIONS;

/**
 * The outcome of saving or changing a playbook. `conflict` means that the status of the playbook
 * does not allow the action.
 */
export type PlaybookResult =
  | { status: "saved"; playbook: PlaybookView }
  | { status: "conflict" }
  | { status: "not_found" };

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
    approvalStatus: playbook.approvalStatus,
    approvedAt: playbook.approvedAt?.toISOString() ?? null,
    periodStatus: getAutoReplyStatus(playbook, now),
    usable: isKnowledgeUsable(playbook, now),
    conditions: conditions
      .toSorted((a, b) => a.channel.localeCompare(b.channel))
      .map((row) => ({ ...row.settings, channel: row.channel }) as ReplyConditionsInput),
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
      topic: input.topic,
      examples: input.examples,
      response: input.response,
      restrictions: input.restrictions,
      contacts: dedupeContacts(input.contacts),
      startsAt: input.startsAt ? new Date(input.startsAt) : null,
      endsAt: input.endsAt ? new Date(input.endsAt) : null,
      timezone: input.timezone,
    },
    conditions: input.conditions.map(({ channel, ...settings }) => ({ channel, settings })),
  };
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
        filters.status ? eq(playbooks.approvalStatus, filters.status) : undefined,
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
 * Creates a draft playbook and its conditions in one transaction, owned by `userId`.
 */
export async function createPlaybook(
  db: Db,
  userId: string,
  input: PlaybookInput,
  now = new Date(),
): Promise<PlaybookView> {
  const { playbook, conditions } = toRows(input);

  return db.transaction(async (tx) => {
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
 * Replaces a playbook and its conditions. A channel that the input leaves out loses its
 * conditions. An approved playbook returns to draft, because the approved text, period and
 * conditions are no longer what was reviewed. A draft or archived playbook keeps its status.
 * Returns `not_found` when the playbook does not exist or belongs to another user, in which case
 * nothing is written.
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
    const [existing] = await tx
      .select()
      .from(playbooks)
      .where(and(eq(playbooks.id, id), eq(playbooks.userId, userId)));

    if (!existing) {
      return { status: "not_found" };
    }

    const wasApproved = existing.approvalStatus === "approved";

    const [updated] = await tx
      .update(playbooks)
      .set({
        ...playbook,
        approvalStatus: wasApproved ? "draft" : existing.approvalStatus,
        approvedAt: wasApproved ? null : existing.approvedAt,
        updatedAt: now,
      })
      .where(eq(playbooks.id, id))
      .returning();

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
        set: { settings: sql`excluded.settings`, updatedAt: now },
      })
      .returning();

    return { status: "saved", playbook: toView(updated, updatedConditions, now) };
  });
}

/**
 * Applies an approval action to a playbook. The status check is part of the update, so the change
 * is atomic. Returns `conflict` when the playbook exists but its status does not allow the action,
 * and `not_found` when it does not exist or belongs to another user.
 */
export async function transitionPlaybook(
  db: Db,
  userId: string,
  id: string,
  action: PlaybookTransition,
  now = new Date(),
): Promise<PlaybookResult> {
  const { from, to } = TRANSITIONS[action];

  const [updated] = await db
    .update(playbooks)
    .set({
      approvalStatus: to,
      approvedAt: to === "approved" ? now : null,
      updatedAt: now,
    })
    .where(
      and(
        eq(playbooks.id, id),
        eq(playbooks.userId, userId),
        inArray(playbooks.approvalStatus, [...from]),
      ),
    )
    .returning();

  const view = await getPlaybook(db, userId, id, now);

  if (updated && view) {
    return { status: "saved", playbook: view };
  }

  return view ? { status: "conflict" } : { status: "not_found" };
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
