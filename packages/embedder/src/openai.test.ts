import { describe, expect, it, vi } from "vitest";

import { createOpenAiEmbedder } from "./openai";

function respondWith(body: unknown, status = 200) {
  return vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status }));
}

function createEmbedder(fetchMock: typeof fetch, dimensions = 2) {
  return createOpenAiEmbedder({
    baseUrl: "https://gateway.test/api/v1/",
    apiKey: "secret",
    model: "embed-model",
    dimensions,
    fetch: fetchMock,
  });
}

describe("createOpenAiEmbedder", () => {
  it("posts the texts to the embeddings endpoint with the key and model", async () => {
    const fetchMock = respondWith({ data: [{ index: 0, embedding: [1, 0] }] });

    await createEmbedder(fetchMock).embed(["hello"]);

    const [url, init] = fetchMock.mock.calls[0];

    expect(url).toBe("https://gateway.test/api/v1/embeddings");
    expect(init?.headers).toMatchObject({ authorization: "Bearer secret" });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: "embed-model",
      input: ["hello"],
    });
  });

  it("returns the vectors in the order of the texts even when the response is shuffled", async () => {
    const fetchMock = respondWith({
      data: [
        { index: 1, embedding: [0, 1] },
        { index: 0, embedding: [1, 0] },
      ],
    });

    const vectors = await createEmbedder(fetchMock).embed(["a", "b"]);

    expect(vectors).toEqual([
      [1, 0],
      [0, 1],
    ]);
  });

  it("does not call the provider for an empty input", async () => {
    const fetchMock = respondWith({ data: [] });

    expect(await createEmbedder(fetchMock).embed([])).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a response with a failing status", async () => {
    const fetchMock = respondWith({ error: "nope" }, 401);

    await expect(createEmbedder(fetchMock).embed(["a"])).rejects.toThrow("status 401");
  });

  it("rejects a response with the wrong number of vectors", async () => {
    const fetchMock = respondWith({ data: [{ index: 0, embedding: [1, 0] }] });

    await expect(createEmbedder(fetchMock).embed(["a", "b"])).rejects.toThrow("Expected 2");
  });

  it("rejects a vector with the wrong number of dimensions", async () => {
    const fetchMock = respondWith({ data: [{ index: 0, embedding: [1, 0, 0] }] });

    await expect(createEmbedder(fetchMock).embed(["a"])).rejects.toThrow("Expected 2 dimensions");
  });
});
