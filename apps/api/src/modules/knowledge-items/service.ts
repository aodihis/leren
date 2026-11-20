import { autoReplyRules, contacts, knowledgeItemContacts, knowledgeItems } from "@leren/db";
import type { Db } from "@leren/db";
import { isKnowledgeUsable } from "@leren/knowledge";
import { and, asc, desc, eq, inArray } from "drizzle-orm";

import type { KnowledgeItemInput, KnowledgeItemListQuery } from "./schema";

type ItemRow = typeof knowledgeItems.$inferSelect;

type ContactView = { id: string; name: string; email: string; role: string };

export type KnowledgeItemView = ReturnType<typeof toView>;

/**
 * The approval changes a person can make. Each action lists the statuses it applies to and the
 * status it leads to. A draft is approved, a draft or approved item is archived, and an archived
 * item returns to draft so that it must be approved again.
 */
const TRANSITIONS = {
  approve: { from: ["draft"], to: "approved" },
  archive: { from: ["draft", "approved"], to: "archived" },
  restore: { from: ["archived"], to: "draft" },
} as const;

export type KnowledgeTransition = keyof typeof TRANSITIONS;

/**
 * The outcome of saving or changing an item. `invalid` carries field errors for a reference that
 * the user does not own, and `conflict` means that the status of the item does not allow the
 * action.
 */
export type KnowledgeResult =
  | { status: "saved"; item: KnowledgeItemView }
  | { status: "invalid"; fieldErrors: Record<string, string[]> }
  | { status: "conflict" }
  | { status: "not_found" };

function toView(item: ItemRow, itemContacts: ContactView[], now: Date) {
  return {
    id: item.id,
    ruleId: item.ruleId,
    topic: item.topic,
    examples: item.examples,
    response: item.response,
    restrictions: item.restrictions,
    validFrom: item.validFrom?.toISOString() ?? null,
    validUntil: item.validUntil?.toISOString() ?? null,
    approvalStatus: item.approvalStatus,
    approvedAt: item.approvedAt?.toISOString() ?? null,
    usable: isKnowledgeUsable(item, now),
    contacts: itemContacts,
  };
}

/**
 * Builds the views of `rows`, loading their contacts with one query.
 */
async function toViews(db: Db, rows: ItemRow[], now: Date) {
  if (rows.length === 0) {
    return [];
  }

  const links = await db
    .select({
      knowledgeItemId: knowledgeItemContacts.knowledgeItemId,
      id: contacts.id,
      name: contacts.name,
      email: contacts.email,
      role: contacts.role,
    })
    .from(knowledgeItemContacts)
    .innerJoin(contacts, eq(contacts.id, knowledgeItemContacts.contactId))
    .where(
      inArray(
        knowledgeItemContacts.knowledgeItemId,
        rows.map((row) => row.id),
      ),
    )
    .orderBy(asc(contacts.name));

  return rows.map((row) =>
    toView(
      row,
      links
        .filter((link) => link.knowledgeItemId === row.id)
        .map(({ id, name, email, role }) => ({ id, name, email, role })),
      now,
    ),
  );
}

/**
 * Checks that the rule and the contacts of `input` belong to `userId`. Returns the field errors to
 * report, or `null` when every reference is the user's own. A reference to the data of another
 * user is reported like a missing one, so a caller cannot learn which IDs exist.
 */
async function findInvalidReferences(db: Db, userId: string, input: KnowledgeItemInput) {
  const fieldErrors: Record<string, string[]> = {};

  const [rule] = await db
    .select({ id: autoReplyRules.id })
    .from(autoReplyRules)
    .where(and(eq(autoReplyRules.id, input.ruleId), eq(autoReplyRules.userId, userId)));

  if (!rule) {
    fieldErrors.ruleId = ["Choose one of your rules"];
  }

  const contactIds = [...new Set(input.contactIds)];

  if (contactIds.length > 0) {
    const owned = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(eq(contacts.userId, userId), inArray(contacts.id, contactIds)));

    if (owned.length !== contactIds.length) {
      fieldErrors.contactIds = ["Choose your own contacts"];
    }
  }

  return Object.keys(fieldErrors).length > 0 ? fieldErrors : null;
}

function toColumns(input: KnowledgeItemInput) {
  return {
    ruleId: input.ruleId,
    topic: input.topic,
    examples: input.examples,
    response: input.response,
    restrictions: input.restrictions,
    validFrom: input.validFrom ? new Date(input.validFrom) : null,
    validUntil: input.validUntil ? new Date(input.validUntil) : null,
  };
}

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

  const views = await toViews(db, rows, now);

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

  return row ? ((await toViews(db, [row], now))[0] ?? null) : null;
}

/**
 * Returns an item that was just written by the caller. The row exists and belongs to `userId`
 * because the write used the same identifiers, so a missing row is a programming error.
 */
async function loadItem(db: Db, userId: string, id: string, now: Date) {
  const item = await getItem(db, userId, id, now);

  if (!item) {
    throw new Error(`Knowledge item ${id} disappeared after it was written`);
  }

  return item;
}

/**
 * Creates a draft item with its contacts in one transaction, owned by `userId`.
 */
export async function createItem(
  db: Db,
  userId: string,
  input: KnowledgeItemInput,
  now = new Date(),
): Promise<KnowledgeResult> {
  const fieldErrors = await findInvalidReferences(db, userId, input);

  if (fieldErrors) {
    return { status: "invalid", fieldErrors };
  }

  const created = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(knowledgeItems)
      .values({ ...toColumns(input), userId })
      .returning();

    const contactIds = [...new Set(input.contactIds)];

    if (contactIds.length > 0) {
      await tx
        .insert(knowledgeItemContacts)
        .values(contactIds.map((contactId) => ({ knowledgeItemId: row.id, contactId })));
    }

    return row;
  });

  return { status: "saved", item: await loadItem(db, userId, created.id, now) };
}

/**
 * Replaces an item and its contacts. An approved item returns to draft, because the approved text
 * is no longer the text that was reviewed. A draft or archived item keeps its status. Returns
 * `not_found` when the item does not exist or belongs to another user, and nothing is written.
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

  const fieldErrors = await findInvalidReferences(db, userId, input);

  if (fieldErrors) {
    return { status: "invalid", fieldErrors };
  }

  const wasApproved = existing.approvalStatus === "approved";

  await db.transaction(async (tx) => {
    await tx
      .update(knowledgeItems)
      .set({
        ...toColumns(input),
        approvalStatus: wasApproved ? "draft" : existing.approvalStatus,
        approvedAt: wasApproved ? null : existing.approvedAt,
        updatedAt: now,
      })
      .where(eq(knowledgeItems.id, id));

    await tx.delete(knowledgeItemContacts).where(eq(knowledgeItemContacts.knowledgeItemId, id));

    const contactIds = [...new Set(input.contactIds)];

    if (contactIds.length > 0) {
      await tx
        .insert(knowledgeItemContacts)
        .values(contactIds.map((contactId) => ({ knowledgeItemId: id, contactId })));
    }
  });

  return { status: "saved", item: await loadItem(db, userId, id, now) };
}

/**
 * Applies an approval change. The update only matches an item that is in one of the statuses the
 * action allows, so two concurrent requests cannot both succeed. Returns `conflict` when the item
 * exists but is in another status, and `not_found` when it does not exist or belongs to another
 * user.
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
    .returning({ id: knowledgeItems.id });

  if (updated) {
    return { status: "saved", item: await loadItem(db, userId, id, now) };
  }

  const existing = await getItem(db, userId, id, now);

  return existing ? { status: "conflict" } : { status: "not_found" };
}

/**
 * Deletes an item and, by cascade, its contact links. Returns whether an item owned by `userId`
 * was deleted.
 */
export async function deleteItem(db: Db, userId: string, id: string): Promise<boolean> {
  const deleted = await db
    .delete(knowledgeItems)
    .where(and(eq(knowledgeItems.id, id), eq(knowledgeItems.userId, userId)))
    .returning({ id: knowledgeItems.id });

  return deleted.length > 0;
}
