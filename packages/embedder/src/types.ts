/**
 * Vendor-neutral contract for turning text into vectors. Application code depends on this file
 * only, so the provider can be replaced by implementing `Embedder`.
 */
export interface Embedder {
  /** The length of every vector that `embed` returns. */
  readonly dimensions: number;

  /**
   * Returns one vector per input text, in the order of `texts`. An empty input returns an empty
   * list without calling the provider.
   */
  embed(texts: string[], options?: { signal?: AbortSignal }): Promise<number[][]>;
}
