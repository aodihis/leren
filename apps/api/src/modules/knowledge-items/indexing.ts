import { KNOWLEDGE_INDEX_QUEUE } from "@leren/knowledge";
import type { KnowledgeIndexMessage } from "@leren/knowledge";
import type { Logger } from "@leren/logger";
import type { QueueClient } from "@leren/queue";

/**
 * Creates the function that asks the worker to bring the vector index of one item up to date. The
 * message names the item and nothing else, so a lost or repeated message cannot leave outdated
 * content in the index. A failed publish is logged and never thrown, because the change is already
 * saved and the periodic drift check repairs an item whose message was lost.
 */
export function createKnowledgeIndexRequester(queue: Pick<QueueClient, "publish">, logger: Logger) {
  return async (itemId: string): Promise<void> => {
    const message: KnowledgeIndexMessage = { itemId };

    try {
      await queue.publish(KNOWLEDGE_INDEX_QUEUE, message);
    } catch (error) {
      logger.error("Could not request a knowledge index update", { itemId, error });
    }
  };
}
