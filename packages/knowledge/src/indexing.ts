import type { KnowledgeUsability } from "./usable";

/** The queue of requests to update a playbook index. */
export const KNOWLEDGE_INDEX_QUEUE = "knowledge.index";

/** The collection with one vector per playbook. */
export const KNOWLEDGE_COLLECTION = "knowledge";

/** The message on the knowledge index queue. */
export type KnowledgeIndexMessage = {
  playbookId: string;
};

/** The playbook fields that the index is built from. */
export interface KnowledgeIndexable extends KnowledgeUsability {
  id: string;
  userId: string;
  topic: string;
  examples: string[];
  response: string;
  updatedAt: Date;
}

/** The payload stored with a vector. */
export type KnowledgeVectorMetadata = {
  playbookId: string;
  userId: string;
  type: "knowledge";
  updatedAt: number;
  startsAt?: number;
  endsAt?: number;
};

/** Reports whether a playbook belongs in the index. */
export function isKnowledgeIndexable(playbook: KnowledgeUsability, now: Date): boolean {
  return playbook.enabled && (!playbook.endsAt || now <= playbook.endsAt);
}

/** Builds the text that is embedded for a playbook. */
export function toEmbeddingText(
  playbook: Pick<KnowledgeIndexable, "topic" | "response" | "examples">,
) {
  return [playbook.topic, playbook.response, ...playbook.examples].join("\n\n");
}

/** Builds the payload stored with a playbook vector. */
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
