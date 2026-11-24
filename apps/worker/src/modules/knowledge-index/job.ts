import { KNOWLEDGE_INDEX_QUEUE } from "@leren/knowledge";

import { defineJob } from "../../job";
import { logger } from "../../logger";
import { knowledgeDriftPayloadSchema, knowledgeIndexPayloadSchema } from "./schema";
import { repairKnowledgeDrift, syncPlaybook } from "./service";
import type { KnowledgeIndexDependencies } from "./service";

/** The queue name of the drift check and repair. */
export const KNOWLEDGE_DRIFT_QUEUE = "knowledge.drift";

/** Brings the index of one playbook up to date. */
export function createKnowledgeIndexJob(dependencies: KnowledgeIndexDependencies) {
  return defineJob({
    name: KNOWLEDGE_INDEX_QUEUE,
    schema: knowledgeIndexPayloadSchema,
    maxAttempts: 5,
    async handler({ playbookId }, context) {
      const outcome = await syncPlaybook(dependencies, playbookId, { signal: context.signal });

      logger
        .child({ job: KNOWLEDGE_INDEX_QUEUE, jobId: context.jobId })
        .info("Playbook synchronised", {
          playbookId,
          outcome,
        });
    },
  });
}

/** Compares PostgreSQL with the index and repairs it. */
export function createKnowledgeDriftJob(dependencies: KnowledgeIndexDependencies) {
  return defineJob({
    name: KNOWLEDGE_DRIFT_QUEUE,
    schema: knowledgeDriftPayloadSchema,
    maxAttempts: 3,
    async handler(_payload, context) {
      const { drift, repaired } = await repairKnowledgeDrift(dependencies, {
        signal: context.signal,
      });

      logger.child({ job: KNOWLEDGE_DRIFT_QUEUE, jobId: context.jobId }).info("Drift checked", {
        missing: drift.missing.length,
        stale: drift.stale.length,
        orphaned: drift.orphaned.length,
        repaired,
      });
    },
  });
}
