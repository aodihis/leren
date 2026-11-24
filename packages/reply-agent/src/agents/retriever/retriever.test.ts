import { beforeEach, describe, expect, it, vi } from "vitest";

const close = vi.fn(async () => {});
const call = vi.fn();

vi.mock("@leren/agents", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("@leren/agents")),
  connectMcp: vi.fn(async () => ({
    servers: [{ name: "leren", tools: [{ mcp: { remoteName: "search_playbooks" }, call }] }],
    close,
  })),
}));

const { connectMcp } = await import("@leren/agents");
const { createMcpRetriever } = await import("./retriever");

const playbook = { id: "p1", topic: "Deadline", information: "Friday.", usable: true };
const mcp = { url: "http://api.test/mcp", token: "token" };

const found = {
  content: [
    {
      type: "text",
      text: JSON.stringify({
        outcome: "ok",
        data: { status: "ok", matches: [{ score: 0.9, playbook }] },
      }),
    },
  ],
};

describe("createMcpRetriever", () => {
  beforeEach(() => {
    call.mockReset();
  });

  it("returns the playbooks that the search tool found", async () => {
    call.mockResolvedValue(found);

    const retriever = createMcpRetriever(mcp);
    const result = await retriever.retrieve("When is the deadline?");

    expect(result).toMatchObject({ status: "ok", playbooks: [{ id: "p1" }] });
    expect(call).toHaveBeenCalledWith({ query: "When is the deadline?" }, expect.anything());
    expect(connectMcp).toHaveBeenCalledWith(
      expect.objectContaining({ ...mcp, allowedTools: ["search_playbooks"] }),
    );
  });

  it("reads a result without a playbook as no reliable result", async () => {
    call.mockResolvedValue({
      content: [
        {
          type: "text",
          text: '{"outcome":"ok","data":{"status":"no_reliable_result","matches":[]}}',
        },
      ],
    });

    const result = await createMcpRetriever(mcp).retrieve("Unknown");

    expect(result).toEqual({ status: "no_reliable_result" });
  });

  it("throws when the tool reports an error, so the queue can retry", async () => {
    call.mockResolvedValue({ isError: true, content: [{ type: "text", text: "Unauthorized" }] });

    await expect(createMcpRetriever(mcp).retrieve("Anything")).rejects.toThrow("failed");
  });

  it("opens a new connection after one failed, and closes without throwing", async () => {
    call.mockResolvedValue(found);
    vi.mocked(connectMcp).mockRejectedValueOnce(new Error("The server is down"));

    const retriever = createMcpRetriever(mcp);

    await expect(retriever.retrieve("one")).rejects.toThrow("The server is down");
    await expect(retriever.retrieve("two")).resolves.toMatchObject({ status: "ok" });
    await expect(retriever.close()).resolves.toBeUndefined();
  });

  it("closes without throwing when the only connection attempt failed", async () => {
    vi.mocked(connectMcp).mockRejectedValueOnce(new Error("The server is down"));

    const retriever = createMcpRetriever(mcp);

    await expect(retriever.retrieve("one")).rejects.toThrow("The server is down");
    await expect(retriever.close()).resolves.toBeUndefined();
  });

  it("opens one connection for several queries and closes it once", async () => {
    call.mockResolvedValue(found);
    vi.mocked(connectMcp).mockClear();
    close.mockClear();

    const retriever = createMcpRetriever(mcp);

    await Promise.all([retriever.retrieve("one"), retriever.retrieve("two")]);
    await retriever.close();
    await retriever.close();

    expect(connectMcp).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
