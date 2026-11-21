/**
 * Vendor-neutral contract for a vector database. Application code depends on
 * this file only, so the backend can be replaced by implementing
 * `VectorStore`.
 */

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

/**
 * Operations every backend supports. Record ids are UUID strings. A filter
 * matches records whose metadata equals every given key and value.
 */
export interface VectorStore {
  ensureCollection(config: CollectionConfig): Promise<void>;
  upsert(collection: string, records: VectorRecord[]): Promise<void>;
  search(query: SearchQuery): Promise<SearchResult[]>;
  delete(collection: string, ids: string[]): Promise<void>;
  /** Returns the id and metadata of every record, without the vectors. Order is unspecified. */
  list(collection: string): Promise<StoredRecord[]>;
  deleteCollection(collection: string): Promise<void>;
}
