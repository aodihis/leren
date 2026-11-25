import { createNoopObserver } from "@leren/observability";
import { InMemoryMemoryStore } from "@anvia/core";
import { createFakeModel } from "@leren/agents/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";

const close = vi.fn(async () => {});

vi.mock("@leren/agents", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("@leren/agents")),
  connectMcp: vi.fn(async () => ({ servers: [], close })),
}));

const { connectMcp } = await import("@leren/agents");
const { runAgent } = await import("./agent");
const { allowedTools } = await import("./utils/mcp");

const mcp = { url: "http://api.test/mcp", token: "token" };

async function collectText(events: AsyncIterable<{ type: string; delta?: string }>) {
  let text = "";

  for await (const event of events) {
    if (event.type === "text_delta") {
      text += event.delta;
    }
  }

  return text;
}

describe("runAgent", () => {
  beforeEach(() => {
    close.mockClear();
  });

  it("returns the model answer and connects with the allowed tools", async () => {
    const answer = await collectText(
      runAgent({
        instructions: "Be brief.",
        messages: [{ role: "user", content: "Hi" }],
        model: createFakeModel([{ text: "Hello" }]),
        observer: createNoopObserver(),
        mcp,
      }),
    );

    expect(answer).toBe("Hello");
    expect(connectMcp).toHaveBeenCalledWith(expect.objectContaining({ ...mcp, allowedTools }));
    expect(close).toHaveBeenCalledOnce();
  });

  it("reports a failed run as an error event and closes the connection", async () => {
    const types: string[] = [];

    for await (const event of runAgent({
      instructions: "Be brief.",
      messages: [{ role: "user", content: "Hi" }],
      model: createFakeModel([]),
      observer: createNoopObserver(),
      mcp,
    })) {
      types.push(event.type);
    }

    expect(types).toContain("error");
    expect(close).toHaveBeenCalledOnce();
  });
});

describe("runAgent with connectors", () => {
  const notion = {
    id: "notion",
    url: "https://mcp.example.com/mcp",
    token: "notion-token",
    allowedTools: ["notion-search", "notion-fetch"],
  };

  const run = (connectors: readonly (typeof notion)[], onConnectorError = vi.fn()) =>
    collectText(
      runAgent({
        instructions: "Be brief.",
        messages: [{ role: "user", content: "Hi" }],
        model: createFakeModel([{ text: "Hello" }]),
        observer: createNoopObserver(),
        mcp,
        connectors,
        onConnectorError,
      }),
    );

  beforeEach(() => {
    vi.mocked(connectMcp).mockClear();
    close.mockClear();
  });

  it("registers no external server when the user has no connectors", async () => {
    await run([]);

    expect(connectMcp).toHaveBeenCalledOnce();
    expect(connectMcp).toHaveBeenCalledWith(expect.objectContaining({ url: mcp.url }));
  });

  it("connects a connected server with its read-only tools and a strict address check", async () => {
    await run([notion]);

    expect(connectMcp).toHaveBeenCalledWith(
      expect.objectContaining({
        token: "notion-token",
        allowedTools: notion.allowedTools,
        toolPrefix: "notion",
        ssrfProtection: "strict",
      }),
    );

    expect(close).toHaveBeenCalledTimes(2);
  });

  it("reports a server that cannot be reached and still answers", async () => {
    const onConnectorError = vi.fn();

    vi.mocked(connectMcp).mockResolvedValueOnce({ servers: [], close });
    vi.mocked(connectMcp).mockRejectedValueOnce(new Error("unreachable"));

    expect(await run([notion], onConnectorError)).toBe("Hello");
    expect(onConnectorError).toHaveBeenCalledWith("notion", expect.any(Error));
  });
});

describe("runAgent with memory", () => {
  /**
   * The store holds the earlier turns, so a client that sends its whole history must not make the
   * model see the same message twice.
   */
  it("sends only the newest user message and replays the rest from the store", async () => {
    const model = createFakeModel([{ text: "First answer" }, { text: "Second answer" }]);
    const store = new InMemoryMemoryStore();
    const session = { sessionId: "chat-1", userId: "user-1" };

    const run = (messages: Parameters<typeof runAgent>[0]["messages"]) =>
      collectText(
        runAgent({
          instructions: "Be brief.",
          messages,
          model,
          observer: createNoopObserver(),
          memory: { store, session },
        }),
      );

    await run([{ role: "user", content: "one" }]);
    await run([
      { role: "user", content: "one" },
      { role: "assistant", content: "First answer" },
      { role: "user", content: "two" },
    ]);

    const second = JSON.stringify(model.requests[1]);

    expect(second.match(/"one"/g)).toHaveLength(1);
    expect(second).toContain("First answer");
    expect(second).toContain("two");
    expect(await store.load({ scope: session })).toHaveLength(4);
  });
});

describe("allowedTools", () => {
  it("has no tool that sends email", () => {
    expect(allowedTools).not.toContain("send_reply");
  });

  /**
   * Guards the boundary that only the user approves knowledge and deletes data: the assistant is
   * never given a tool for either, whatever the MCP server offers.
   */
  it("has no tool that approves or deletes", () => {
    expect(allowedTools.filter((tool) => /approve|delete|archive/.test(tool))).toEqual([]);
  });
});
