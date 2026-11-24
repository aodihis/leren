/** A vendor-neutral contract for embedding text. */
export interface Embedder {
  /** The length of every vector that `embed` returns. */
  readonly dimensions: number;

  /** Returns one vector per input text. */
  embed(texts: string[], options?: { signal?: AbortSignal }): Promise<number[][]>;
}
