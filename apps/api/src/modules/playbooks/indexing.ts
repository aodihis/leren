import { KNOWLEDGE_INDEX_QUEUE } from "@leren/knowledge";
import type { KnowledgeIndexMessage } from "@leren/knowledge";
import type { Logger } from "@leren/logger";
import type { QueueClient } from "@leren/queue";

/**
 * Creates the function that asks the worker to update the vector index of one playbook. The message
 * names only the playbook, so a lost or repeated message cannot leave outdated content. A failed
 * publish is logged, not thrown, and the periodic drift check repairs it.
 */
export function createKnowledgeIndexRequester(queue: Pick<QueueClient, "publish">, logger: Logger) {
  return async (playbookId: string): Promise<void> => {
    const message: KnowledgeIndexMessage = { playbookId };

    try {
      await queue.publish(KNOWLEDGE_INDEX_QUEUE, message);
    } catch (error) {
      logger.error("Could not request a knowledge index update", { playbookId, error });
    }
  };
}
