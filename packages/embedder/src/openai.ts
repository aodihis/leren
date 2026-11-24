import type { Embedder } from "./types";

export type OpenAiEmbedderOptions = {
  /** The endpoint root of the embeddings API. */
  baseUrl: string;
  apiKey: string;
  model: string;
  dimensions: number;
  fetch?: typeof fetch;
};

type EmbeddingsResponse = {
  data?: Array<{ index: number; embedding: number[] }>;
};

/** Creates an Embedder for an OpenAI-style endpoint. */
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
