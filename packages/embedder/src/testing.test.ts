import { describe, expect, it } from "vitest";

import { createFakeEmbedder } from "./testing";

function dot(a: number[], b: number[]): number {
  return a.reduce((sum, value, index) => sum + value * b[index], 0);
}

describe("createFakeEmbedder", () => {
  it("returns the same vector for the same text", async () => {
    const embedder = createFakeEmbedder();

    const [first] = await embedder.embed(["Office hours"]);
    const [second] = await embedder.embed(["office HOURS"]);

    expect(first).toEqual(second);
    expect(first).toHaveLength(embedder.dimensions);
  });

  it("returns unit vectors", async () => {
    const [vector] = await createFakeEmbedder().embed(["opening hours on friday"]);

    expect(dot(vector, vector)).toBeCloseTo(1);
  });

  it("makes texts that share words more similar than texts that do not", async () => {
    const [query, related, unrelated] = await createFakeEmbedder(256).embed([
      "friday opening hours",
      "the office opening hours on friday",
      "invoice payment terms",
    ]);

    expect(dot(query, related)).toBeGreaterThan(dot(query, unrelated));
  });
});
