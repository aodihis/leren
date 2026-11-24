import { KNOWLEDGE_INDEX_QUEUE } from "@leren/knowledge";
import type { KnowledgeIndexMessage } from "@leren/knowledge";
import type { Logger } from "@leren/logger";
import type { QueueClient } from "@leren/queue";

/** Creates the function that requests indexing. */
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
