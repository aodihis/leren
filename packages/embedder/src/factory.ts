import { createOpenAiEmbedder } from "./openai";
import type { Embedder } from "./types";

/** Settings for the embedding provider. None of them name a vendor. */
export type EmbedderOptions = {
  /** The endpoint root of the embedding service. */
  baseUrl: string;
  apiKey: string;
  /** The identifier of the embedding model, as the service expects it. */
  model: string;
  /** The length of every vector the model returns. */
  dimensions: number;
  fetch?: typeof fetch;
};

/**
 * Creates the `Embedder` that the applications use. Callers depend on this function and on the
 * `Embedder` contract only, so the implementation behind it can change without touching them.
 * The implementation is currently the OpenAI-compatible one.
 */
export function createEmbedder(options: EmbedderOptions): Embedder {
  return createOpenAiEmbedder(options);
}
