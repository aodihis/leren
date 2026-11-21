import { autoReplyRules, replyConditions } from "@leren/db";
import type { Db } from "@leren/db";
import { getAutoReplyStatus } from "@leren/auto-reply";
import { and, desc, eq, inArray, notInArray, sql } from "drizzle-orm";

import type { AutoReplyRuleInput, ReplyConditionsInput } from "./schema";

type RuleRow = typeof autoReplyRules.$inferSelect;

type ConditionsRow = typeof replyConditions.$inferSelect;

/**
 * Converts the stored rows to the representation the API returns. Each conditions row becomes one
 * entry that names its channel. The status is derived from the rule and `now` and is not stored.
 * The stored settings were validated against the schema of their channel when they were written.
 */
function toView(rule: RuleRow, conditions: ConditionsRow[], now: Date) {
  return {
    id: rule.id,
    name: rule.name,
    enabled: rule.enabled,
    startsAt: rule.startsAt?.toISOString() ?? null,
    endsAt: rule.endsAt?.toISOString() ?? null,
    timezone: rule.timezone,
    status: getAutoReplyStatus(rule, now),
    conditions: conditions
      .toSorted((a, b) => a.channel.localeCompare(b.channel))
      .map((row) => ({ ...row.settings, channel: row.channel }) as ReplyConditionsInput),
  };
}

/**
 * Splits a request body into the columns of the rule and the conditions rows. The channel is a
 * column of its own and is not repeated in the settings.
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
    conditions: input.conditions.map(({ channel, ...settings }) => ({ channel, settings })),
  };
}

/**
 * Lists a user's rules, newest first. The query is scoped to `userId`.
 */
export async function listRules(db: Db, userId: string, now = new Date()) {
  const rules = await db
    .select()
    .from(autoReplyRules)
    .where(eq(autoReplyRules.userId, userId))
    .orderBy(desc(autoReplyRules.createdAt));

  const rows =
    rules.length === 0
      ? []
      : await db
          .select()
          .from(replyConditions)
          .where(
            inArray(
              replyConditions.ruleId,
              rules.map((rule) => rule.id),
            ),
          );

  return rules.map((rule) =>
    toView(
      rule,
      rows.filter((row) => row.ruleId === rule.id),
      now,
    ),
  );
}

/**
 * Returns one rule, or `null` when it does not exist or belongs to another user. The two cases are
 * indistinguishable, so a caller cannot learn which IDs exist.
 */
export async function getRule(db: Db, userId: string, id: string, now = new Date()) {
  const [rule] = await db
    .select()
    .from(autoReplyRules)
    .where(and(eq(autoReplyRules.id, id), eq(autoReplyRules.userId, userId)));

  if (!rule) {
    return null;
  }

  const rows = await db.select().from(replyConditions).where(eq(replyConditions.ruleId, id));

  return toView(rule, rows, now);
}

/**
 * Creates a rule and its conditions in one transaction, owned by `userId`.
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

    const createdConditions = await tx
      .insert(replyConditions)
      .values(conditions.map((entry) => ({ ...entry, ruleId: createdRule.id })))
      .returning();

    return toView(createdRule, createdConditions, now);
  });
}

/**
 * Replaces a rule and its conditions. A channel that the input leaves out loses its conditions.
 * Returns `null` when the rule does not exist or belongs to another user, in which case nothing is
 * written.
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

    await tx.delete(replyConditions).where(
      and(
        eq(replyConditions.ruleId, updatedRule.id),
        notInArray(
          replyConditions.channel,
          conditions.map((entry) => entry.channel),
        ),
      ),
    );

    const updatedConditions = await tx
      .insert(replyConditions)
      .values(conditions.map((entry) => ({ ...entry, ruleId: updatedRule.id })))
      .onConflictDoUpdate({
        target: [replyConditions.ruleId, replyConditions.channel],
        set: { settings: sql`excluded.settings`, updatedAt: now },
      })
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
