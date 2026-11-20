import { autoReplyRules, emailReplyConditions } from "@leren/db";
import type { Db } from "@leren/db";
import { getAutoReplyStatus } from "@leren/auto-reply";
import { and, desc, eq } from "drizzle-orm";

import type { AutoReplyRuleInput } from "./schema";

type RuleRow = typeof autoReplyRules.$inferSelect;

type ConditionsRow = typeof emailReplyConditions.$inferSelect;

/**
 * Converts the stored rows to the representation the API returns. The status is derived from the
 * rule and `now` and is not stored.
 */
function toView(rule: RuleRow, conditions: ConditionsRow, now: Date) {
  return {
    id: rule.id,
    name: rule.name,
    enabled: rule.enabled,
    startsAt: rule.startsAt?.toISOString() ?? null,
    endsAt: rule.endsAt?.toISOString() ?? null,
    timezone: rule.timezone,
    status: getAutoReplyStatus(rule, now),
    email: {
      senderMode: conditions.senderMode,
      senderAllowlist: conditions.senderAllowlist,
      replyWhenTo: conditions.replyWhenTo,
      replyWhenCc: conditions.replyWhenCc,
      replyWhenBcc: conditions.replyWhenBcc,
      requireSoleRecipient: conditions.requireSoleRecipient,
      mentionOverrides: conditions.mentionOverrides,
      mentionDetection: conditions.mentionDetection,
      mentionAliases: conditions.mentionAliases,
      threadMode: conditions.threadMode,
      skipBulkMail: conditions.skipBulkMail,
    },
  };
}

/**
 * Splits a request body into the columns of the rule and of its email conditions.
 */
function toRows(input: AutoReplyRuleInput) {
  return {
    rule: {
      name: input.name,
      enabled: input.enabled,
      startsAt: input.startsAt ? new Date(input.startsAt) : null,
      endsAt: input.endsAt ? new Date(input.endsAt) : null,
      timezone: input.timezone,
    },
    conditions: input.email,
  };
}

/**
 * Lists a user's rules, newest first. The query is scoped to `userId`.
 */
export async function listRules(db: Db, userId: string, now = new Date()) {
  const rows = await db
    .select()
    .from(autoReplyRules)
    .innerJoin(emailReplyConditions, eq(emailReplyConditions.ruleId, autoReplyRules.id))
    .where(eq(autoReplyRules.userId, userId))
    .orderBy(desc(autoReplyRules.createdAt));

  return rows.map((row) => toView(row.auto_reply_rules, row.email_reply_conditions, now));
}

/**
 * Returns one rule, or `null` when it does not exist or belongs to another user. The two cases are
 * indistinguishable, so a caller cannot learn which IDs exist.
 */
export async function getRule(db: Db, userId: string, id: string, now = new Date()) {
  const [row] = await db
    .select()
    .from(autoReplyRules)
    .innerJoin(emailReplyConditions, eq(emailReplyConditions.ruleId, autoReplyRules.id))
    .where(and(eq(autoReplyRules.id, id), eq(autoReplyRules.userId, userId)));

  return row ? toView(row.auto_reply_rules, row.email_reply_conditions, now) : null;
}

/**
 * Creates a rule and its email conditions in one transaction, owned by `userId`.
 */
export async function createRule(
  db: Db,
  userId: string,
  input: AutoReplyRuleInput,
  now = new Date(),
) {
  const { rule, conditions } = toRows(input);

  return db.transaction(async (tx) => {
    const [createdRule] = await tx
      .insert(autoReplyRules)
      .values({ ...rule, userId })
      .returning();

    const [createdConditions] = await tx
      .insert(emailReplyConditions)
      .values({ ...conditions, ruleId: createdRule.id })
      .returning();

    return toView(createdRule, createdConditions, now);
  });
}

/**
 * Replaces a rule and its email conditions. Returns `null` when the rule does not exist or belongs
 * to another user, in which case nothing is written.
 */
export async function updateRule(
  db: Db,
  userId: string,
  id: string,
  input: AutoReplyRuleInput,
  now = new Date(),
) {
  const { rule, conditions } = toRows(input);

  return db.transaction(async (tx) => {
    const [updatedRule] = await tx
      .update(autoReplyRules)
      .set({ ...rule, updatedAt: now })
      .where(and(eq(autoReplyRules.id, id), eq(autoReplyRules.userId, userId)))
      .returning();

    if (!updatedRule) {
      return null;
    }

    const [updatedConditions] = await tx
      .update(emailReplyConditions)
      .set({ ...conditions, updatedAt: now })
      .where(eq(emailReplyConditions.ruleId, updatedRule.id))
      .returning();

    return toView(updatedRule, updatedConditions, now);
  });
}

/**
 * Deletes a rule and, by cascade, its conditions. Returns whether a rule owned by `userId` was
 * deleted.
 */
export async function deleteRule(db: Db, userId: string, id: string): Promise<boolean> {
  const deleted = await db
    .delete(autoReplyRules)
    .where(and(eq(autoReplyRules.id, id), eq(autoReplyRules.userId, userId)))
    .returning({ id: autoReplyRules.id });

  return deleted.length > 0;
}
