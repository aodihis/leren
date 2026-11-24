/** A vendor-neutral contract for a vector database. */

export type VectorMetadata = Record<string, string | number | boolean>;

export type VectorRecord = {
  id: string;
  vector: number[];
  metadata?: VectorMetadata;
};

export type SearchQuery = {
  collection: string;
  vector: number[];
  limit: number;
  filter?: VectorMetadata;
};

export type SearchResult = {
  id: string;
  score: number;
  metadata: VectorMetadata;
};

export type StoredRecord = {
  id: string;
  metadata: VectorMetadata;
};

export type CollectionConfig = {
  name: string;
  dimensions: number;
};

/** The operations that every backend supports. */
export interface VectorStore {
  ensureCollection(config: CollectionConfig): Promise<void>;
  upsert(collection: string, records: VectorRecord[]): Promise<void>;
  search(query: SearchQuery): Promise<SearchResult[]>;
  delete(collection: string, ids: string[]): Promise<void>;
  /** Returns the id and metadata of every record. */
  list(collection: string): Promise<StoredRecord[]>;
  deleteCollection(collection: string): Promise<void>;
}
