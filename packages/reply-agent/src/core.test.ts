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
const { allowedTools } = await import("./utils/mcp");

const mcp = { url: "http://api.test/mcp", token: "token" };

describe("runAgent", () => {
  beforeEach(() => {
    close.mockClear();
  });

  it("returns the model answer and connects with the allowed tools", async () => {
    const answer = await runAgent({
      prompt: "Email: when is the deadline?",
      model: createFakeModel([{ text: "Hello" }]),
      observer: createNoopObserver(),
      mcp,
    });

    expect(answer).toBe("Hello");
    expect(connectMcp).toHaveBeenCalledWith(expect.objectContaining({ ...mcp, allowedTools }));
    expect(close).toHaveBeenCalledOnce();
  });

  it("closes the connection when the run fails", async () => {
    await expect(
      runAgent({
        prompt: "Email: when is the deadline?",
        model: createFakeModel([]),
        observer: createNoopObserver(),
        mcp,
      }),
    ).rejects.toThrow();

    expect(close).toHaveBeenCalledOnce();
  });
});

describe("allowedTools", () => {
  it("has no tool that sends email", () => {
    expect(allowedTools).not.toContain("send_reply");
  });
});
