import type { Db } from "@leren/db";
import type { QueueClient } from "@leren/queue";

import type { JobDefinition } from "../job";
import { createEmailGateJob } from "./email-gate/job";
import { createEmailPollJob } from "./email-poll/job";
import type { EmailPollJobDependencies } from "./email-poll/job";
import { createKnowledgeDriftJob, createKnowledgeIndexJob } from "./knowledge-index/job";
import type { KnowledgeIndexDependencies } from "./knowledge-index/service";
import { createReplyDeliverJob } from "./reply-deliver/job";
import type { ReplyDeliverDependencies } from "./reply-deliver/service";
import { createReplyRunJob } from "./reply-run/job";
import type { ReplyRunJobDependencies } from "./reply-run/job";
import { runAgentJob } from "./run-agent/job";

/**
 * What the jobs need, grouped by the role that needs it (decision 0045). A role whose group is
 * missing is not started, so a process only builds, and only requires, what its roles use.
 */
export type JobDependencies = {
  db: Db;
  queue: Pick<QueueClient, "publish">;
  /** The `listener` role: reads mailboxes. */
  listener?: Pick<EmailPollJobDependencies, "channels" | "pollIntervalMs"> | undefined;
  /**
   * The `processor` role: runs the gate, the reply pipeline, the reply deliverer and the agent
   * jobs. Without `reply` the reply pipeline is disabled, and the messages that the gate queued
   * wait in the queue. `deliver` holds what the deliverer needs to reach the mailboxes.
   */
  processor?:
    | {
        reply?: ReplyRunJobDependencies | undefined;
        deliver: Pick<ReplyDeliverDependencies, "channels">;
      }
    | undefined;
  /** The `indexer` role: keeps the vector index of the knowledge up to date. */
  indexer?: Pick<KnowledgeIndexDependencies, "store" | "embedder"> | undefined;
};

/**
 * Builds the jobs of the roles that the dependencies name. Jobs that need collaborators receive
 * them here, so tests and the entry point choose the database, the vector store, the embedder and
 * the queue.
 */
export function createJobs({
  db,
  queue,
  listener,
  processor,
  indexer,
}: JobDependencies): JobDefinition[] {
  const jobs: JobDefinition[] = [];

  if (listener) {
    jobs.push(createEmailPollJob({ db, queue, ...listener }));
  }

  if (processor) {
    jobs.push(
      runAgentJob,
      createEmailGateJob({ db, queue }),
      createReplyDeliverJob({ db, ...processor.deliver }),
    );

    if (processor.reply) {
      jobs.push(createReplyRunJob(processor.reply));
    }
  }

  if (indexer) {
    const dependencies = { db, ...indexer };

    jobs.push(createKnowledgeIndexJob(dependencies), createKnowledgeDriftJob(dependencies));
  }

  return jobs;
}
