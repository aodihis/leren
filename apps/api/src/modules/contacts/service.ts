import { contacts } from "@leren/db";
import type { Db } from "@leren/db";
import { and, asc, eq, ne } from "drizzle-orm";

import type { ContactInput } from "./schema";

type ContactRow = typeof contacts.$inferSelect;

/**
 * The outcome of saving a contact. `duplicate` means that the user already has a contact with the
 * same address.
 */
export type SaveContactResult =
  | { status: "saved"; contact: ReturnType<typeof toView> }
  | { status: "duplicate" }
  | { status: "not_found" };

function toView(row: ContactRow) {
  return { id: row.id, name: row.name, email: row.email, role: row.role };
}

/**
 * Lists a user's contacts by name. The query is scoped to `userId`.
 */
export async function listContacts(db: Db, userId: string) {
  const rows = await db
    .select()
    .from(contacts)
    .where(eq(contacts.userId, userId))
    .orderBy(asc(contacts.name));

  return rows.map(toView);
}

/**
 * Creates a contact owned by `userId`, unless the user already has one with the same address.
 */
export async function createContact(
  db: Db,
  userId: string,
  input: ContactInput,
): Promise<SaveContactResult> {
  const [created] = await db
    .insert(contacts)
    .values({ ...input, userId })
    .onConflictDoNothing()
    .returning();

  return created ? { status: "saved", contact: toView(created) } : { status: "duplicate" };
}

/**
 * Replaces a contact. Returns `not_found` when it does not exist or belongs to another user, and
 * `duplicate` when another contact of the user already has the new address.
 */
export async function updateContact(
  db: Db,
  userId: string,
  id: string,
  input: ContactInput,
  now = new Date(),
): Promise<SaveContactResult> {
  const [duplicate] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.userId, userId), eq(contacts.email, input.email), ne(contacts.id, id)));

  if (duplicate) {
    return { status: "duplicate" };
  }

  const [updated] = await db
    .update(contacts)
    .set({ ...input, updatedAt: now })
    .where(and(eq(contacts.id, id), eq(contacts.userId, userId)))
    .returning();

  return updated ? { status: "saved", contact: toView(updated) } : { status: "not_found" };
}

/**
 * Deletes a contact and, by cascade, its links to knowledge items. Returns whether a contact owned
 * by `userId` was deleted.
 */
export async function deleteContact(db: Db, userId: string, id: string): Promise<boolean> {
  const deleted = await db
    .delete(contacts)
    .where(and(eq(contacts.id, id), eq(contacts.userId, userId)))
    .returning({ id: contacts.id });

  return deleted.length > 0;
}
