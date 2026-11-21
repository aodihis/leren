import type { Embedder } from "./types";

export type OpenAiEmbedderOptions = {
  /** The endpoint root, such as `https://openrouter.ai/api/v1`. `/embeddings` is appended to it. */
  baseUrl: string;
  apiKey: string;
  model: string;
  dimensions: number;
  fetch?: typeof fetch;
};

type EmbeddingsResponse = {
  data?: Array<{ index: number; embedding: number[] }>;
};

/**
 * Creates an `Embedder` for any endpoint that implements the OpenAI embeddings API. The endpoint
 * decides which service answers, so a compatible gateway needs no new implementation. A response
 * whose vectors do not match the requested count or `dimensions` is rejected, because a vector of
 * the wrong size cannot be stored in the collection.
 */
export function createOpenAiEmbedder(options: OpenAiEmbedderOptions): Embedder {
  const { baseUrl, apiKey, model, dimensions } = options;
  const request = options.fetch ?? fetch;
  const url = `${baseUrl.replace(/\/+$/, "")}/embeddings`;

  return {
    dimensions,

    async embed(texts, { signal } = {}) {
      if (texts.length === 0) {
        return [];
      }

      const response = await request(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, input: texts, encoding_format: "float" }),
        signal,
      });

      if (!response.ok) {
        throw new Error(`The embeddings request failed with status ${response.status}`);
      }

      const body = (await response.json()) as EmbeddingsResponse;
      const vectors = (body.data ?? []).toSorted((a, b) => a.index - b.index);

      if (vectors.length !== texts.length) {
        throw new Error(`Expected ${texts.length} embeddings, received ${vectors.length}`);
      }

      return vectors.map(({ embedding }) => {
        if (embedding.length !== dimensions) {
          throw new Error(`Expected ${dimensions} dimensions, received ${embedding.length}`);
        }

        return embedding;
      });
    },
  };
}
