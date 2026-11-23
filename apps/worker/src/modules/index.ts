import type { JobDefinition } from "../job";
import { createEmailGateJob } from "./email-gate/job";
import type { EmailGateJobDependencies } from "./email-gate/job";
import { createEmailPollJob } from "./email-poll/job";
import type { EmailPollJobDependencies } from "./email-poll/job";
import { createKnowledgeDriftJob, createKnowledgeIndexJob } from "./knowledge-index/job";
import type { KnowledgeIndexDependencies } from "./knowledge-index/service";
import { createReplyRunJob } from "./reply-run/job";
import type { ReplyRunJobDependencies } from "./reply-run/job";
import { runAgentJob } from "./run-agent/job";

export type JobDependencies = KnowledgeIndexDependencies &
  EmailGateJobDependencies &
  EmailPollJobDependencies & {
    /**
     * What the reply pipeline needs. Without it the worker does not consume `email.process`, and the
     * messages that the gate queued wait in the queue.
     */
    reply?: ReplyRunJobDependencies | undefined;
  };

/**
 * Builds every job the worker consumes. Jobs that need collaborators receive them here, so tests
 * and the entry point choose the database, the vector store, the embedder and the queue.
 */
export function createJobs(dependencies: JobDependencies): JobDefinition[] {
  const jobs: JobDefinition[] = [
    runAgentJob,
    createKnowledgeIndexJob(dependencies),
    createKnowledgeDriftJob(dependencies),
    createEmailGateJob(dependencies),
    createEmailPollJob(dependencies),
  ];

  if (dependencies.reply) {
    jobs.push(createReplyRunJob(dependencies.reply));
  }

  return jobs;
}
