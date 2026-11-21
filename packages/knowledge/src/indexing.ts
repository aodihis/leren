import type { KnowledgeUsability } from "./usable";

/** The queue that carries a request to bring the vector index of one item up to date. */
export const KNOWLEDGE_INDEX_QUEUE = "knowledge.index";

/** The vector collection that holds one vector per indexable knowledge item. */
export const KNOWLEDGE_COLLECTION = "knowledge";

/**
 * The message on `KNOWLEDGE_INDEX_QUEUE`. It names the item and nothing else. The consumer reads
 * the current row, so a message never carries content that could be out of date.
 */
export type KnowledgeIndexMessage = {
  itemId: string;
};

/**
 * The fields of a knowledge item that the index is built from.
 */
export interface KnowledgeIndexable extends KnowledgeUsability {
  id: string;
  userId: string;
  ruleId: string;
  topic: string;
  examples: string[];
  response: string;
  updatedAt: Date;
}

/**
 * The payload stored with a vector. It holds only strings, numbers and booleans, so every vector
 * store can keep it. `validFrom` and `validUntil` are epoch milliseconds and are absent when the
 * bound is open. `updatedAt` identifies the version of the row that the vector was built from.
 */
export type KnowledgeVectorMetadata = {
  knowledgeId: string;
  userId: string;
  ruleId: string;
  type: "knowledge";
  updatedAt: number;
  validFrom?: number;
  validUntil?: number;
};

/**
 * Reports whether an item belongs in the vector index at `now`. An item is indexed when it is
 * approved and its validity window has not ended. An item whose window has not started yet is
 * indexed, so that it is searchable from the moment the window opens, and retrieval applies
 * `isKnowledgeUsable` to decide whether it may be used.
 */
export function isKnowledgeIndexable(item: KnowledgeUsability, now: Date): boolean {
  return item.approvalStatus === "approved" && (!item.validUntil || now <= item.validUntil);
}

/**
 * Builds the text that is embedded for an item: the topic, the response and the example messages,
 * which makes an item findable by how a sender might phrase a message and not only by its topic.
 */
export function toEmbeddingText(item: Pick<KnowledgeIndexable, "topic" | "response" | "examples">) {
  return [item.topic, item.response, ...item.examples].join("\n\n");
}

/**
 * Builds the payload stored with the vector of an item.
 */
export function toVectorMetadata(item: KnowledgeIndexable): KnowledgeVectorMetadata {
  const metadata: KnowledgeVectorMetadata = {
    knowledgeId: item.id,
    userId: item.userId,
    ruleId: item.ruleId,
    type: "knowledge",
    updatedAt: item.updatedAt.getTime(),
  };

  if (item.validFrom) {
    metadata.validFrom = item.validFrom.getTime();
  }

  if (item.validUntil) {
    metadata.validUntil = item.validUntil.getTime();
  }

  return metadata;
}
