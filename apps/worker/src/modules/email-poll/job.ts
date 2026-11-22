import type { ChannelAccountsDependencies } from "@leren/channels";
import type { Db } from "@leren/db";
import { recordInboundEmail } from "@leren/inbox";
import type { QueueClient } from "@leren/queue";
import { z } from "zod";

import { defineJob } from "../../job";
import { logger } from "../../logger";
import { listPollableAccountIds, pollAccount } from "./service";

/** The name of the queue that asks for one poll of one account's mailbox. */
export const EMAIL_POLL_QUEUE = "email.poll";

/**
 * The payload of `email.poll`. `requestedAt` is the time of the request in milliseconds, so a poll
 * that waited in the queue for longer than the job tolerates is dropped.
 */
export const emailPollPayloadSchema = z.object({
  accountId: z.uuid(),
  requestedAt: z.number().int(),
});

/** A poll older than this many intervals is dropped, because a newer one has been requested. */
const STALE_AFTER_INTERVALS = 2;

export type EmailPollJobDependencies = {
  db: Db;
  channels: ChannelAccountsDependencies;
  queue: Pick<QueueClient, "publish">;
  /** The time between the requests for polls, in milliseconds. */
  pollIntervalMs: number;
};

/**
 * Polls the mailbox of one account. Every failure is retried, because the provider and the
 * database may be briefly unavailable, and a retry resumes from the stored cursor.
 */
export function createEmailPollJob({
  db,
  channels,
  queue,
  pollIntervalMs,
}: EmailPollJobDependencies) {
  return defineJob({
    name: EMAIL_POLL_QUEUE,
    schema: emailPollPayloadSchema,
    maxAttempts: 3,
    async handler({ accountId, requestedAt }, context) {
      const jobLogger = logger.child({ job: EMAIL_POLL_QUEUE, jobId: context.jobId });

      if (Date.now() - requestedAt > pollIntervalMs * STALE_AFTER_INTERVALS) {
        jobLogger.info("Dropped a stale mailbox poll", { accountId });

        return;
      }

      const outcome = await pollAccount(
        {
          db,
          channels,
          recordEmail: (email) => recordInboundEmail({ db, queue }, email),
        },
        accountId,
      );

      jobLogger.info("Mailbox polled", { accountId, outcome });

      if (outcome.kind === "baseline" && outcome.gap) {
        jobLogger.warn("Mail was not ingested because the mailbox history is no longer available", {
          accountId,
        });
      }

      if (outcome.kind === "ingested" && outcome.unreadable.length > 0) {
        jobLogger.warn("Messages were left out because they could not be read", {
          accountId,
          messageIds: outcome.unreadable,
        });
      }
    },
  });
}

/**
 * Publishes one poll for every account that the listener reads. A failure is logged and does not
 * stop the others, because the next tick asks again.
 */
export async function requestEmailPolls({
  db,
  channels,
  queue,
}: Omit<EmailPollJobDependencies, "pollIntervalMs">): Promise<number> {
  const accountIds = await listPollableAccountIds(db, channels.providers);

  const results = await Promise.allSettled(
    accountIds.map((accountId) =>
      queue.publish(EMAIL_POLL_QUEUE, { accountId, requestedAt: Date.now() }),
    ),
  );

  for (const result of results) {
    if (result.status === "rejected") {
      logger.error("Could not request an email poll", { error: result.reason });
    }
  }

  return accountIds.length;
}
