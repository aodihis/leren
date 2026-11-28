import { EMAIL_DELIVER_QUEUE, emailDeliverMessageSchema } from "@leren/inbox";
import { NonRetryableError } from "@leren/queue";

import { defineJob } from "../../job";
import { logger } from "../../logger";
import { deliverReply, failUnfinishedDelivery } from "./service";
import type { ReplyDeliverDependencies } from "./service";

/** The number of deliveries after which a reply that cannot be delivered is marked as failed. */
export const REPLY_DELIVER_MAX_ATTEMPTS = 5;

/**
 * Consumes `email.deliver` and delivers the reply of one message as a draft or a sent mail
 * (decision 0046). Only a failure known not to have reached the provider is retried. A final
 * failure marks the delivery and message as failed and dead-letters the job.
 */
export function createReplyDeliverJob(dependencies: ReplyDeliverDependencies) {
  return defineJob({
    name: EMAIL_DELIVER_QUEUE,
    schema: emailDeliverMessageSchema,
    maxAttempts: REPLY_DELIVER_MAX_ATTEMPTS,
    async handler(payload, context) {
      const log = logger.child({ job: EMAIL_DELIVER_QUEUE, jobId: context.jobId });

      try {
        const outcome = await deliverReply(dependencies, payload);

        log.info("Delivery run ended", { messageId: payload.messageId, outcome });
      } catch (error) {
        const final =
          error instanceof NonRetryableError || context.attempt >= REPLY_DELIVER_MAX_ATTEMPTS;

        if (final) {
          await failUnfinishedDelivery(
            dependencies.db,
            payload.messageId,
            error instanceof Error ? error.message : String(error),
          );
        }

        throw error;
      }
    },
  });
}
