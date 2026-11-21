import { autoReplyRules, knowledgeItems } from "@leren/db";
import type { Db } from "@leren/db";
import { isKnowledgeUsable } from "@leren/knowledge";
import { and, desc, eq, inArray } from "drizzle-orm";

import type { KnowledgeItemInput, KnowledgeItemListQuery } from "./schema";

type ItemRow = typeof knowledgeItems.$inferSelect;

export type KnowledgeItemView = ReturnType<typeof toView>;

/**
 * The approval actions. Each action lists the statuses it applies to and the status it leads to.
 * Restoring leads to draft and not to approved, so that a restored item is reviewed again.
 */
const TRANSITIONS = {
  approve: { from: ["draft"], to: "approved" },
  archive: { from: ["draft", "approved"], to: "archived" },
  restore: { from: ["archived"], to: "draft" },
} as const;

export type KnowledgeTransition = keyof typeof TRANSITIONS;

/**
 * The outcome of saving or changing an item. `invalid` carries field errors for a rule that the
 * user does not own, and `conflict` means that the status of the item does not allow the action.
 */
export type KnowledgeResult =
  | { status: "saved"; item: KnowledgeItemView }
  | { status: "invalid"; fieldErrors: Record<string, string[]> }
  | { status: "conflict" }
  | { status: "not_found" };

function toView(item: ItemRow, now: Date) {
  return {
    id: item.id,
    ruleId: item.ruleId,
    topic: item.topic,
    examples: item.examples,
    response: item.response,
    restrictions: item.restrictions,
    contacts: item.contacts,
    validFrom: item.validFrom?.toISOString() ?? null,
    validUntil: item.validUntil?.toISOString() ?? null,
    approvalStatus: item.approvalStatus,
    approvedAt: item.approvedAt?.toISOString() ?? null,
    usable: isKnowledgeUsable(item, now),
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
 * Reports whether the rule belongs to `userId`. A rule of another user is reported like a missing
 * one, so a caller cannot learn which IDs exist.
 */
async function ownsRule(db: Db, userId: string, ruleId: string): Promise<boolean> {
  const [rule] = await db
    .select({ id: autoReplyRules.id })
    .from(autoReplyRules)
    .where(and(eq(autoReplyRules.id, ruleId), eq(autoReplyRules.userId, userId)));

  return rule !== undefined;
}

function toColumns(input: KnowledgeItemInput) {
  return {
    ruleId: input.ruleId,
    topic: input.topic,
    examples: input.examples,
    response: input.response,
    restrictions: input.restrictions,
    contacts: dedupeContacts(input.contacts),
    validFrom: input.validFrom ? new Date(input.validFrom) : null,
    validUntil: input.validUntil ? new Date(input.validUntil) : null,
  };
}

const INVALID_RULE: KnowledgeResult = {
  status: "invalid",
  fieldErrors: { ruleId: ["Choose one of your rules"] },
};

/**
 * Lists a user's items, newest first, narrowed by the optional filters. The query is scoped to
 * `userId`. The `usable` filter applies the same rule as retrieval does.
 */
export async function listItems(
  db: Db,
  userId: string,
  filters: KnowledgeItemListQuery = {},
  now = new Date(),
) {
  const rows = await db
    .select()
    .from(knowledgeItems)
    .where(
      and(
        eq(knowledgeItems.userId, userId),
        filters.ruleId ? eq(knowledgeItems.ruleId, filters.ruleId) : undefined,
        filters.status ? eq(knowledgeItems.approvalStatus, filters.status) : undefined,
      ),
    )
    .orderBy(desc(knowledgeItems.createdAt));

  const views = rows.map((row) => toView(row, now));

  return filters.usable ? views.filter((view) => view.usable) : views;
}

/**
 * Returns one item, or `null` when it does not exist or belongs to another user. The two cases are
 * indistinguishable.
 */
export async function getItem(db: Db, userId: string, id: string, now = new Date()) {
  const [row] = await db
    .select()
    .from(knowledgeItems)
    .where(and(eq(knowledgeItems.id, id), eq(knowledgeItems.userId, userId)));

  return row ? toView(row, now) : null;
}

/**
 * Creates a draft item owned by `userId`. The rule must belong to the same user.
 */
export async function createItem(
  db: Db,
  userId: string,
  input: KnowledgeItemInput,
  now = new Date(),
): Promise<KnowledgeResult> {
  if (!(await ownsRule(db, userId, input.ruleId))) {
    return INVALID_RULE;
  }

  const [created] = await db
    .insert(knowledgeItems)
    .values({ ...toColumns(input), userId })
    .returning();

  return { status: "saved", item: toView(created, now) };
}

/**
 * Replaces an item. An approved item returns to draft, because the approved text is no longer the
 * text that was reviewed. A draft or archived item keeps its status. Returns `not_found` when the
 * item does not exist or belongs to another user, and nothing is written.
 */
export async function updateItem(
  db: Db,
  userId: string,
  id: string,
  input: KnowledgeItemInput,
  now = new Date(),
): Promise<KnowledgeResult> {
  const [existing] = await db
    .select()
    .from(knowledgeItems)
    .where(and(eq(knowledgeItems.id, id), eq(knowledgeItems.userId, userId)));

  if (!existing) {
    return { status: "not_found" };
  }

  if (!(await ownsRule(db, userId, input.ruleId))) {
    return INVALID_RULE;
  }

  const wasApproved = existing.approvalStatus === "approved";

  const [updated] = await db
    .update(knowledgeItems)
    .set({
      ...toColumns(input),
      approvalStatus: wasApproved ? "draft" : existing.approvalStatus,
      approvedAt: wasApproved ? null : existing.approvedAt,
      updatedAt: now,
    })
    .where(eq(knowledgeItems.id, id))
    .returning();

  return { status: "saved", item: toView(updated, now) };
}

/**
 * Applies an approval action to an item. The status check is part of the update, so the change is
 * atomic. Returns `conflict` when the item exists but its status does not allow the action, and
 * `not_found` when it does not exist or belongs to another user.
 */
export async function transitionItem(
  db: Db,
  userId: string,
  id: string,
  action: KnowledgeTransition,
  now = new Date(),
): Promise<KnowledgeResult> {
  const { from, to } = TRANSITIONS[action];

  const [updated] = await db
    .update(knowledgeItems)
    .set({
      approvalStatus: to,
      approvedAt: to === "approved" ? now : null,
      updatedAt: now,
    })
    .where(
      and(
        eq(knowledgeItems.id, id),
        eq(knowledgeItems.userId, userId),
        inArray(knowledgeItems.approvalStatus, [...from]),
      ),
    )
    .returning();

  if (updated) {
    return { status: "saved", item: toView(updated, now) };
  }

  const existing = await getItem(db, userId, id, now);

  return existing ? { status: "conflict" } : { status: "not_found" };
}

/**
 * Deletes an item. Returns whether an item owned by `userId` was deleted.
 */
export async function deleteItem(db: Db, userId: string, id: string): Promise<boolean> {
  const deleted = await db
    .delete(knowledgeItems)
    .where(and(eq(knowledgeItems.id, id), eq(knowledgeItems.userId, userId)))
    .returning({ id: knowledgeItems.id });

  return deleted.length > 0;
}
