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
const { allowedTools, approvalTools } = await import("./utils/mcp");

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

  it("returns the model answer and connects with the allowed and approval tools", async () => {
    const answer = await collectText(
      runAgent({
        instructions: "Be brief.",
        prompt: "Hi",
        model: createFakeModel([{ text: "Hello" }]),
        observer: createNoopObserver(),
        mcp,
      }),
    );

    expect(answer).toBe("Hello");
    expect(connectMcp).toHaveBeenCalledWith(
      expect.objectContaining({ ...mcp, allowedTools, approvalTools }),
    );
    expect(close).toHaveBeenCalledOnce();
  });

  it("reports a failed run as an error event and closes the connection", async () => {
    const types: string[] = [];

    for await (const event of runAgent({
      instructions: "Be brief.",
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

  /**
   * Guards the boundary that only the user approves knowledge and deletes data: the assistant is
   * never given a tool for either, whatever the MCP server offers.
   */
  it("has no tool that approves or deletes", () => {
    expect(allowedTools.filter((tool) => /approve|delete|archive/.test(tool))).toEqual([]);
  });

  /**
   * Guards the confirmation contract of decision 0032: a tool that is added to the allow-list as a
   * writer must also be an approval tool, so no write runs without the user's approval.
   */
  it("requires approval for every tool that writes and for no tool that reads", () => {
    expect([...approvalTools].sort()).toEqual(
      allowedTools.filter((tool) => /^(create|update)_/.test(tool)).sort(),
    );
  });
});
