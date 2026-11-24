import { createQdrantStore } from "./qdrant";
import type { VectorStore } from "./types";

export type VectorStoreConfig = {
  url: string;
};

/** Creates the application's vector store. */
export function createVectorStore(config: VectorStoreConfig): VectorStore {
  return createQdrantStore(config.url);
}
