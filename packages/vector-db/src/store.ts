import { createQdrantStore } from "./qdrant";
import type { VectorStore } from "./types";

export type VectorStoreConfig = {
  url: string;
  apiKey?: string;
};

/**
 * Creates the application's vector store. This is the only place that chooses
 * the backend, so callers never depend on a specific vector database.
 */
export function createVectorStore(config: VectorStoreConfig): VectorStore {
  return createQdrantStore(config.url, config.apiKey);
}
