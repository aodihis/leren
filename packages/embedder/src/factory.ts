import { createOpenAiEmbedder } from "./openai";
import type { Embedder } from "./types";

/** Settings for the embedding provider. */
export type EmbedderOptions = {
  /** The endpoint root of the embedding service. */
  baseUrl: string;
  apiKey: string;
  /** The identifier of the embedding model. */
  model: string;
  /** The length of every vector the model returns. */
  dimensions: number;
  fetch?: typeof fetch;
};

/** Creates the Embedder that applications use. */
export function createEmbedder(options: EmbedderOptions): Embedder {
  return createOpenAiEmbedder(options);
}
