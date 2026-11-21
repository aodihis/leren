import { createTool } from "@anvia/core";
import type { McpServer, McpTool } from "@anvia/mcp";
import { createNoopObserver } from "@leren/observability";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createAgent } from "./factory";
import { restrictTools } from "./mcp";
import { createFakeModel } from "./testing";

const lookup = createTool({
  name: "lookup",
  description: "Looks up a value.",
  inputSchema: z.object({ key: z.string() }),
  async execute({ key }) {
    return { key };
  },
});

function mcpTool(remoteName: string): McpTool {
  return { ...lookup, mcp: { serverName: "leren", remoteName } } as McpTool;
}

describe("createAgent", () => {
  it("returns the model text when no tool is called", async () => {
    const model = createFakeModel([{ text: "Hello" }]);

    const agent = createAgent({
      id: "test",
      maxTurns: 2,
      model,
      instructions: "Be brief.",
      observer: createNoopObserver(),
    });

    const response = await agent.generate({ prompt: "Hi" });

    expect(response.type === "response" && response.output).toBe("Hello");
    expect(model.requests).toHaveLength(1);
  });

  it("runs a tool and sends its result back to the model", async () => {
    const model = createFakeModel([
      { toolCalls: [{ name: "lookup", input: { key: "a" } }] },
      { text: "Done" },
    ]);

    const agent = createAgent({
      id: "test",
      maxTurns: 2,
      model,
      instructions: "Use tools.",
      observer: createNoopObserver(),
      tools: [lookup],
    });

    const response = await agent.generate({ prompt: "Find a" });

    expect(response.type === "response" && response.output).toBe("Done");
    expect(model.requests).toHaveLength(2);
  });

  it("stops at the turn limit", async () => {
    const loop = { toolCalls: [{ name: "lookup", input: { key: "a" } }] };
    const model = createFakeModel(Array.from({ length: 10 }, () => loop));

    const agent = createAgent({
      id: "test",
      maxTurns: 2,
      model,
      instructions: "Use tools.",
      observer: createNoopObserver(),
      tools: [lookup],
    });

    await expect(agent.generate({ prompt: "Loop" })).rejects.toThrow();
    expect(model.requests.length).toBeLessThanOrEqual(3);
  });
});

describe("restrictTools", () => {
  it("keeps only allow-listed tools", () => {
    const server: McpServer = {
      name: "leren",
      tools: [mcpTool("search_knowledge"), mcpTool("send_reply")],
    };

    const restricted = restrictTools(server, ["search_knowledge"]);

    expect(restricted.tools.map((tool) => tool.mcp.remoteName)).toEqual(["search_knowledge"]);
  });

  it("requires approval only for the tools named as approval tools", () => {
    const server: McpServer = {
      name: "leren",
      tools: [mcpTool("search_knowledge"), mcpTool("create_rule")],
    };

    const restricted = restrictTools(server, ["search_knowledge", "create_rule"], ["create_rule"]);
    const byName = Object.fromEntries(restricted.tools.map((tool) => [tool.mcp.remoteName, tool]));

    expect(byName.create_rule?.requiresApproval).toBe(true);
    expect(byName.search_knowledge?.requiresApproval).toBeUndefined();
  });
});
