import { createNoopObserver } from "@leren/observability";
import { createFakeModel } from "@leren/agents/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";

const close = vi.fn(async () => {});

vi.mock("@leren/agents", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("@leren/agents")),
  connectMcp: vi.fn(async () => ({ servers: [], close })),
}));

const { connectMcp } = await import("@leren/agents");
const { runAgent } = await import("./core");
const { allowedTools } = await import("./tools");

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
        prompt: "Hi",
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
      prompt: "Hi",
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

describe("allowedTools", () => {
  it("has no tool that sends email", () => {
    expect(allowedTools).not.toContain("send_reply");
  });
});
