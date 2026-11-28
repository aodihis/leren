import { EMAIL_PROCESS_QUEUE, emailProcessMessageSchema, transitionMessage } from "@leren/inbox";
import type { Observer } from "@leren/observability";
import { NonRetryableError } from "@leren/queue";

import { defineJob } from "../../job";
import { logger } from "../../logger";
import { processMessage } from "./service";
import type { ReplyRunDependencies } from "./service";

/** The number of deliveries after which a failing message is marked as failed. */
export const REPLY_RUN_MAX_ATTEMPTS = 3;

/** The reason that is stored when the pipeline could not finish a message. */
export const PIPELINE_ERROR = "pipeline_error";

export type ReplyRunJobDependencies = ReplyRunDependencies & {
  /** Delivers the telemetry of a run when it ends, so that it is not held until shutdown. */
  observer: Pick<Observer, "flush">;
};

/**
 * Consumes `email.process` and runs the reply pipeline for one queued message (decision 0043). A
 * failure is retried. A final failure marks the message as failed so that the user sees it, and
 * dead-letters the job.
 */
export function createReplyRunJob(dependencies: ReplyRunJobDependencies) {
  const { db, observer } = dependencies;

  return defineJob({
    name: EMAIL_PROCESS_QUEUE,
    schema: emailProcessMessageSchema,
    maxAttempts: REPLY_RUN_MAX_ATTEMPTS,
    async handler(payload, context) {
      const log = logger.child({ job: EMAIL_PROCESS_QUEUE, jobId: context.jobId });

      try {
        const outcome = await processMessage(dependencies, payload, context.signal);

        log.info("Message processed", { messageId: payload.messageId, outcome });
      } catch (error) {
        const final =
          error instanceof NonRetryableError || context.attempt >= REPLY_RUN_MAX_ATTEMPTS;

        if (final) {
          await transitionMessage(db, payload.messageId, "failed", PIPELINE_ERROR, [
            "queued",
            "processing",
          ]);
        }

        throw error;
      } finally {
        await observer.flush().catch((error: unknown) => {
          log.warn("Could not deliver the telemetry", { error });
        });
      }
    },
  });
}
