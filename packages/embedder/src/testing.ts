import type { Embedder } from "./types";

const DEFAULT_DIMENSIONS = 64;

function hashToken(token: string): number {
  let hash = 2166136261;

  for (const character of token) {
    hash = Math.imul(hash ^ (character.codePointAt(0) ?? 0), 16777619) >>> 0;
  }

  return hash;
}

/** Creates an Embedder that needs no network. */
export function createFakeEmbedder(dimensions = DEFAULT_DIMENSIONS): Embedder {
  function embedText(text: string): number[] {
    const vector = Array.from({ length: dimensions }, () => 0);

    for (const token of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
      if (token) {
        vector[hashToken(token) % dimensions] += 1;
      }
    }

    const norm = Math.hypot(...vector);

    return norm === 0 ? vector : vector.map((value) => value / norm);
  }

  return {
    dimensions,

    async embed(texts) {
      return texts.map(embedText);
    },
  };
}
