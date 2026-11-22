import { describe, expect, it, vi } from "vitest";

import { createEmbedder } from "./factory";

describe("createEmbedder", () => {
  it("returns an embedder with the requested dimensions that calls the endpoint", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ data: [{ index: 0, embedding: [1, 0] }] })),
    );

    const embedder = createEmbedder({
      baseUrl: "https://gateway.test/v1",
      apiKey: "secret",
      model: "embed-model",
      dimensions: 2,
      fetch: fetchMock,
    });

    expect(embedder.dimensions).toBe(2);
    expect(await embedder.embed(["hello"])).toEqual([[1, 0]]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
