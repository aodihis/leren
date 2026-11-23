import { messages, playbooks, replyDecisions } from "@leren/db";
import type { Db } from "@leren/db";
import type { SQL } from "drizzle-orm";
import { and, count, desc, eq, gte, lte, or, sql } from "drizzle-orm";

const RECENT_FAILURES = 5;
const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;

/** The number of rows for each value of a column, keyed by the value. A value without rows is absent. */
type Counts<Key extends string> = Partial<Record<Key, number>>;

type Status = typeof messages.$inferSelect.status;

type Outcome = typeof replyDecisions.$inferSelect.outcome;

type DeliveryState = NonNullable<typeof replyDecisions.$inferSelect.deliveryState>;

/** Turns grouped rows into counts and skips the group of rows whose value is null. */
function toCounts<Key extends string>(rows: { key: Key | null; total: number }[]): Counts<Key> {
  const counts: Counts<Key> = {};

  for (const { key, total } of rows) {
    if (key !== null) {
      counts[key] = total;
    }
  }

  return counts;
}

function sum(counts: Counts<string>): number {
  let total = 0;

  for (const value of Object.values(counts)) {
    total += value ?? 0;
  }

  return total;
}

/**
 * Counts the decisions of the messages that match `where`, grouped by outcome and by delivery
 * state. A decision that has no delivery state is not counted in `byDeliveryState`.
 */
async function countDecisions(db: Db, where: SQL | undefined) {
  const [byOutcome, byDeliveryState] = await Promise.all([
    db
      .select({ key: replyDecisions.outcome, total: count() })
      .from(messages)
      .innerJoin(replyDecisions, eq(replyDecisions.messageId, messages.id))
      .where(where)
      .groupBy(replyDecisions.outcome),
    db
      .select({ key: replyDecisions.deliveryState, total: count() })
      .from(messages)
      .innerJoin(replyDecisions, eq(replyDecisions.messageId, messages.id))
      .where(where)
      .groupBy(replyDecisions.deliveryState),
  ]);

  return {
    byOutcome: toCounts<Outcome>(byOutcome),
    byDeliveryState: toCounts<DeliveryState>(byDeliveryState),
  };
}

/**
 * The counts of the messages that a user received inside a window (decision 0048). `total` counts
 * every message, `byStatus` groups them by their status, and `byOutcome` and `byDeliveryState`
 * group the messages that have a decision, so a value that no message has is absent. `failures` are
 * the newest messages whose status is `failed` or whose delivery failed.
 */
export async function getOverview(db: Db, userId: string, days: number, now = new Date()) {
  const since = new Date(now.getTime() - days * DAY_IN_MILLISECONDS);
  const inWindow = and(eq(messages.userId, userId), gte(messages.receivedAt, since));

  const [byStatus, decisions, failures] = await Promise.all([
    db
      .select({ key: messages.status, total: count() })
      .from(messages)
      .where(inWindow)
      .groupBy(messages.status),
    countDecisions(db, inWindow),
    db
      .select({ message: messages, decision: replyDecisions })
      .from(messages)
      .leftJoin(replyDecisions, eq(replyDecisions.messageId, messages.id))
      .where(
        and(
          inWindow,
          or(eq(messages.status, "failed"), eq(replyDecisions.deliveryState, "failed")),
        ),
      )
      .orderBy(desc(messages.receivedAt), desc(messages.id))
      .limit(RECENT_FAILURES),
  ]);

  const statusCounts = toCounts<Status>(byStatus);

  return {
    days,
    since: since.toISOString(),
    total: sum(statusCounts),
    byStatus: statusCounts,
    ...decisions,
    failures: failures.map(({ message, decision }) => ({
      id: message.id,
      from: message.fromAddress,
      subject: message.subject,
      receivedAt: message.receivedAt.toISOString(),
      status: message.status,
      statusReason: message.statusReason,
      deliveryState: decision?.deliveryState ?? null,
      deliveryError: decision?.deliveryError ?? null,
    })),
  };
}

/**
 * The report of one playbook for its period (decision 0048). The status is `not_found` when the
 * user has no such playbook and `period_not_ended` when the playbook has no end or its end is after
 * `now`. Otherwise the report counts the decisions that used the playbook for messages received
 * between the start and the end of the period, grouped by outcome and by delivery state, and the
 * decisions whose reply cites the playbook. A playbook without a start is counted from the
 * beginning.
 */
export async function getPlaybookReport(db: Db, userId: string, id: string, now = new Date()) {
  const [playbook] = await db
    .select()
    .from(playbooks)
    .where(and(eq(playbooks.id, id), eq(playbooks.userId, userId)));

  if (!playbook) {
    return { status: "not_found" as const };
  }

  if (!playbook.endsAt || playbook.endsAt > now) {
    return { status: "period_not_ended" as const };
  }

  const inPeriod = and(
    eq(messages.userId, userId),
    sql`${id} = ANY(${replyDecisions.playbookIds})`,
    playbook.startsAt ? gte(messages.receivedAt, playbook.startsAt) : undefined,
    lte(messages.receivedAt, playbook.endsAt),
  );

  const [decisions, [cited]] = await Promise.all([
    countDecisions(db, inPeriod),
    db
      .select({ total: count() })
      .from(messages)
      .innerJoin(replyDecisions, eq(replyDecisions.messageId, messages.id))
      .where(and(inPeriod, sql`${id} = ANY(${replyDecisions.citations})`)),
  ]);

  return {
    status: "ready" as const,
    report: {
      playbook: {
        id: playbook.id,
        topic: playbook.topic,
        startsAt: playbook.startsAt?.toISOString() ?? null,
        endsAt: playbook.endsAt.toISOString(),
        timezone: playbook.timezone,
      },
      total: sum(decisions.byOutcome),
      cited: cited?.total ?? 0,
      ...decisions,
    },
  };
}
