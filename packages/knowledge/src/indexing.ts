import type { KnowledgeUsability } from "./usable";

/** The queue that carries a request to bring the vector index of one playbook up to date. */
export const KNOWLEDGE_INDEX_QUEUE = "knowledge.index";

/** The vector collection that holds one vector per indexable playbook. */
export const KNOWLEDGE_COLLECTION = "knowledge";

/**
 * The message on `KNOWLEDGE_INDEX_QUEUE`. It names the playbook and nothing else. The consumer reads
 * the current row, so a message never carries content that could be out of date.
 */
export type KnowledgeIndexMessage = {
  playbookId: string;
};

/**
 * The fields of a playbook that the index is built from.
 */
export interface KnowledgeIndexable extends KnowledgeUsability {
  id: string;
  userId: string;
  topic: string;
  information: string;
  updatedAt: Date;
}

/**
 * The payload stored with a vector. It holds only strings, numbers and booleans, so every vector
 * store can keep it. `startsAt` and `endsAt` are epoch milliseconds and are absent when the
 * bound is open. `updatedAt` identifies the version of the row that the vector was built from.
 */
export type KnowledgeVectorMetadata = {
  playbookId: string;
  userId: string;
  type: "knowledge";
  updatedAt: number;
  startsAt?: number;
  endsAt?: number;
};

/**
 * Reports whether a playbook belongs in the vector index at `now`. A playbook is indexed when it is
 * enabled and its period has not ended. A playbook whose period has not started yet is
 * indexed, so that it is searchable from the moment the period opens, and retrieval applies
 * `isKnowledgeUsable` to decide whether it may be used.
 */
export function isKnowledgeIndexable(playbook: KnowledgeUsability, now: Date): boolean {
  return playbook.enabled && (!playbook.endsAt || now <= playbook.endsAt);
}

/**
 * Builds the text that is embedded for a playbook: the topic and the information. The instruction
 * says how to answer and not what a message is about, so it is not embedded.
 */
export function toEmbeddingText(playbook: Pick<KnowledgeIndexable, "topic" | "information">) {
  return [playbook.topic, playbook.information].join("\n\n");
}

/**
 * Builds the payload stored with the vector of a playbook.
 */
export function toVectorMetadata(playbook: KnowledgeIndexable): KnowledgeVectorMetadata {
  const metadata: KnowledgeVectorMetadata = {
    playbookId: playbook.id,
    userId: playbook.userId,
    type: "knowledge",
    updatedAt: playbook.updatedAt.getTime(),
  };

  if (playbook.startsAt) {
    metadata.startsAt = playbook.startsAt.getTime();
  }

  if (playbook.endsAt) {
    metadata.endsAt = playbook.endsAt.getTime();
  }

  return metadata;
}
