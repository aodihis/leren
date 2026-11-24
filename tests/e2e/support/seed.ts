import { channelAccounts, createDb, messages, playbooks, replyDecisions, users } from "@leren/db";
import type { Db } from "@leren/db";
import { eq } from "drizzle-orm";

import { getE2eDatabaseUrl } from "./database";

const DAY = 24 * 60 * 60 * 1000;

/**
 * Connects to the end-to-end database, runs `work` with the user whose address is `email` and closes
 * the connection. Throws when no user has the address.
 */
async function withUser<T>(
  email: string,
  work: (db: Db, user: typeof users.$inferSelect) => Promise<T>,
): Promise<T> {
  const db = createDb(getE2eDatabaseUrl());

  try {
    const [user] = await db.select().from(users).where(eq(users.email, email));

    if (!user) {
      throw new Error(`No user has the address ${email}`);
    }

    return await work(db, user);
  } finally {
    await db.$client.end();
  }
}

async function insertAccount(db: Db, userId: string, email: string) {
  const [account] = await db
    .insert(channelAccounts)
    .values({
      userId,
      channel: "email",
      provider: "mailpit",
      providerAccountId: email,
      label: email,
    })
    .returning({ id: channelAccounts.id });

  return account;
}

/**
 * Connects an email account, labelled with `email`, to the user with that address. A playbook that
 * is enabled has to name an account (decision 0044), so a test that creates one connects an account
 * first.
 */
export async function seedChannelAccount(email: string): Promise<void> {
  await withUser(email, (db, user) => insertAccount(db, user.id, email));
}

type SeededMessage = {
  subject: string;
  daysAgo: number;
  status: typeof messages.$inferInsert.status;
  decision?: Omit<typeof replyDecisions.$inferInsert, "messageId" | "userId">;
};

/**
 * Writes the records of a finished playbook period for the user `email`: a playbook that ended a
 * day ago, and the messages that it handled while it was running, with their decisions, and two
 * messages that failed. The overview of the user then has six messages and two failures, and the
 * report of the playbook has four decisions. Returns the topic of the playbook.
 */
export async function seedFinishedPlaybook(email: string): Promise<string> {
  return withUser(email, async (db, user) => {
    const now = Date.now();
    const account = await insertAccount(db, user.id, email);

    const [playbook] = await db
      .insert(playbooks)
      .values({
        userId: user.id,
        topic: "Vacation cover",
        information: "I am away and back on Monday.",
        timezone: "UTC",
        startsAt: new Date(now - 10 * DAY),
        endsAt: new Date(now - DAY),
      })
      .returning({ id: playbooks.id, topic: playbooks.topic });

    const used = { playbookIds: [playbook?.id ?? ""] };
    const cited = { ...used, citations: used.playbookIds };
    const started = { deliveryRequest: {}, deliveryStartedAt: new Date(now - 3 * DAY) };

    const seeded: SeededMessage[] = [
      {
        subject: "Project deadline",
        daysAgo: 8,
        status: "sent",
        decision: {
          outcome: "answer",
          ...cited,
          deliveryMode: "send",
          deliveryState: "completed",
          sentMessageId: "sent-1",
          ...started,
        },
      },
      {
        subject: "Room booking",
        daysAgo: 7,
        status: "drafted",
        decision: {
          outcome: "answer",
          ...cited,
          deliveryMode: "draft",
          deliveryState: "completed",
          mailboxDraftId: "draft-1",
          ...started,
        },
      },
      {
        subject: "Contract question",
        daysAgo: 6,
        status: "escalated",
        decision: { outcome: "escalate", ...used },
      },
      {
        subject: "Invoice question",
        daysAgo: 5,
        status: "drafted",
        decision: {
          outcome: "answer",
          ...cited,
          deliveryMode: "draft",
          deliveryState: "failed",
          deliveryError: "The mailbox refused the draft.",
        },
      },
      {
        subject: "Weekly newsletter",
        daysAgo: 4,
        status: "not_applicable",
        decision: { outcome: "ignore" },
      },
      { subject: "Broken attachment", daysAgo: 3, status: "failed" },
    ];

    for (const { subject, daysAgo, status, decision } of seeded) {
      const [message] = await db
        .insert(messages)
        .values({
          userId: user.id,
          channelAccountId: account?.id,
          channel: "email",
          provider: "mailpit",
          providerMessageId: crypto.randomUUID(),
          fromAddress: "colleague@example.com",
          toAddresses: [email],
          subject,
          body: `${subject}: please reply when you can.`,
          receivedAt: new Date(now - daysAgo * DAY),
          status,
        })
        .returning({ id: messages.id });

      if (decision) {
        await db
          .insert(replyDecisions)
          .values({ ...decision, messageId: message?.id ?? "", userId: user.id });
      }
    }

    return playbook?.topic ?? "";
  });
}
