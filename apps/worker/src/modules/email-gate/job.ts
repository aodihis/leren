import { EMAIL_PROCESS_QUEUE, EMAIL_RECEIVED_QUEUE } from "@leren/inbox";
import type { EmailProcessMessage } from "@leren/inbox";
import type { QueueClient } from "@leren/queue";

import { defineJob } from "../../job";
import { logger } from "../../logger";
import { emailGatePayloadSchema } from "./schema";
import { gateMessage } from "./service";
import type { EmailGateDependencies } from "./service";

export type EmailGateJobDependencies = Pick<EmailGateDependencies, "db"> & {
  queue: Pick<QueueClient, "publish">;
};

/**
 * Runs the gate for one recorded message. Every failure is retried, because the database and the
 * queue may be briefly unavailable and a retry reads the current record. The message to the
 * pipeline carries the id of the record as its idempotency key.
 */
export function createEmailGateJob({ db, queue }: EmailGateJobDependencies) {
  return defineJob({
    name: EMAIL_RECEIVED_QUEUE,
    schema: emailGatePayloadSchema,
    maxAttempts: 5,
    async handler({ messageId }, context) {
      const outcome = await gateMessage(
        {
          db,
          publishProcess: async (message: EmailProcessMessage) => {
            await queue.publish(EMAIL_PROCESS_QUEUE, message, {
              idempotencyKey: message.messageId,
            });
          },
        },
        messageId,
      );

      logger.child({ job: EMAIL_RECEIVED_QUEUE, jobId: context.jobId }).info("Message gated", {
        messageId,
        outcome,
      });
    },
  });
}
