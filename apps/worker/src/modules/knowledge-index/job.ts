import { KNOWLEDGE_INDEX_QUEUE } from "@leren/knowledge";

import { defineJob } from "../../job";
import { logger } from "../../logger";
import { knowledgeDriftPayloadSchema, knowledgeIndexPayloadSchema } from "./schema";
import { repairKnowledgeDrift, syncKnowledgeItem } from "./service";
import type { KnowledgeIndexDependencies } from "./service";

/** The name of the queue that triggers a drift check and repair. */
export const KNOWLEDGE_DRIFT_QUEUE = "knowledge.drift";

/**
 * Brings the vector index of one knowledge item up to date. Every failure is retried, because the
 * database and the vector store may be briefly unavailable and a retry reads the current row.
 */
export function createKnowledgeIndexJob(dependencies: KnowledgeIndexDependencies) {
  return defineJob({
    name: KNOWLEDGE_INDEX_QUEUE,
    schema: knowledgeIndexPayloadSchema,
    maxAttempts: 5,
    async handler({ itemId }, context) {
      const outcome = await syncKnowledgeItem(dependencies, itemId, { signal: context.signal });

      logger.child({ job: KNOWLEDGE_INDEX_QUEUE, jobId: context.jobId }).info("Item synchronised", {
        itemId,
        outcome,
      });
    },
  });
}

/**
 * Compares PostgreSQL with the vector index and repairs the differences. It also removes the
 * vectors of items whose validity window has ended, because nothing else reacts to time passing.
 */
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
