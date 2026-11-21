import { agentToClientStream } from "@anvia/client";
import { Agent, createTool } from "@anvia/core";
import { createClientStreamResponse } from "@anvia/server";
import { createFakeModel } from "@leren/agents/testing";
import type { FakeStep } from "@leren/agents/testing";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const authClient = vi.hoisted(() => ({ getSession: vi.fn() }));

const assistantApi = vi.hoisted(() => ({
  $get: vi.fn(),
  conversations: { ":sessionId": { $get: vi.fn(), $delete: vi.fn() } },
}));

const itemsApi = vi.hoisted(() => ({ $get: vi.fn() }));
const rulesApi = vi.hoisted(() => ({ $get: vi.fn() }));

vi.mock("../../../modules/auth/auth-client", () => ({ authClient }));

vi.mock("../../../modules/api/api-client", () => ({
  api: {
    api: {
      assistant: assistantApi,
      "knowledge-items": itemsApi,
      "auto-reply-rules": rulesApi,
    },
  },
}));

import { renderApp } from "../../../testing";

const SESSION_ID = "33333333-3333-4333-8333-333333333333";

const createKnowledge = createTool({
  name: "create_knowledge",
  description: "Creates a knowledge item.",
  inputSchema: z.object({ topic: z.string(), response: z.string() }),
  execute: async () => ({ id: "item-1" }),
} as never);

/**
 * Stands in for the API's chat endpoint: it runs a real agent over a scripted model and answers
 * with a real Anvia client stream, so the panel is tested against the actual protocol.
 */
function stubChatEndpoint(steps: readonly FakeStep[]) {
  const agent = new Agent({
    id: "assistant",
    model: createFakeModel(steps),
    instructions: "Help.",
    maxTurns: 5,
    tools: [createKnowledge as never],
  });

  const fetchStub = vi.fn(async (_url: string, init: RequestInit) => {
    const { messages } = JSON.parse(String(init.body));
    const { content } = messages.at(-1);

    const prompt: string = Array.isArray(content)
      ? content.map((part: { text: string }) => part.text).join("")
      : content;

    return createClientStreamResponse({
      events: agentToClientStream({ events: agent.stream({ prompt }) }),
    });
  });

  vi.stubGlobal("fetch", fetchStub);

  return fetchStub;
}

async function openPanel(user: ReturnType<typeof userEvent.setup>) {
  await renderApp("/knowledge");
  await user.click(await screen.findByRole("button", { name: "Assistant" }));

  return screen.findByRole("region", { name: "Assistant" });
}

describe("assistant panel on the knowledge screen", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    window.localStorage.clear();
    itemsApi.$get.mockImplementation(async () => Response.json({ items: [] }));
    rulesApi.$get.mockImplementation(async () => Response.json({ rules: [] }));
    assistantApi.$get.mockImplementation(async () =>
      Response.json({ available: true, conversations: [] }),
    );
    authClient.getSession.mockResolvedValue({
      data: { user: { id: "u1", name: "Ada", email: "ada@example.com" } },
      error: null,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps the screen usable and the panel closed until it is opened", async () => {
    await renderApp("/knowledge");

    expect(await screen.findByRole("button", { name: "Assistant" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Assistant" })).toBeNull();
    expect(assistantApi.$get).not.toHaveBeenCalled();
  });

  it("streams an answer and sends the conversation id and title with the message", async () => {
    const user = userEvent.setup();
    const fetchStub = stubChatEndpoint([{ text: "Hi there" }]);
    const panel = await openPanel(user);

    await user.type(within(panel).getByLabelText("Message"), "Hello");
    await user.click(within(panel).getByRole("button", { name: "Send" }));

    expect(await within(panel).findByText("Hi there")).toBeTruthy();
    expect(within(panel).getByText("Hello")).toBeTruthy();
    expect(String(fetchStub.mock.calls[0][0])).toMatch(/\/api\/assistant\/chat\?sessionId=[\w-]+$/);
    expect(JSON.parse(String(fetchStub.mock.calls[0][1].body)).messages.at(-1).metadata).toEqual({
      title: "Hello",
    });
  });

  it("reloads the screen's data after the assistant saves something", async () => {
    const user = userEvent.setup();

    stubChatEndpoint([
      { toolCalls: [{ name: "create_knowledge", input: { topic: "Launch", response: "Jan 15" } }] },
      { text: "I saved it as a draft." },
    ]);

    const panel = await openPanel(user);
    const loadsBefore = itemsApi.$get.mock.calls.length;

    await user.type(within(panel).getByLabelText("Message"), "Add the launch date");
    await user.click(within(panel).getByRole("button", { name: "Send" }));

    expect(await within(panel).findByText("I saved it as a draft.")).toBeTruthy();
    expect(itemsApi.$get.mock.calls.length).toBeGreaterThan(loadsBefore);
  });

  it("opens an earlier chat from the history", async () => {
    const user = userEvent.setup();

    assistantApi.$get.mockImplementation(async () =>
      Response.json({
        available: true,
        conversations: [{ id: SESSION_ID, title: "Vacation rules", updatedAt: "2026-11-21" }],
      }),
    );

    assistantApi.conversations[":sessionId"].$get.mockImplementation(async () =>
      Response.json({
        messages: [
          { role: "user", content: "Which rules exist?" },
          { role: "assistant", content: [{ type: "text", text: "You have one rule." }] },
        ],
      }),
    );

    const panel = await openPanel(user);

    await user.click(await within(panel).findByRole("button", { name: "Chat history" }));
    await user.click(await screen.findByRole("menuitem", { name: /Vacation rules/ }));

    expect(await within(panel).findByText("You have one rule.")).toBeTruthy();
    expect(within(panel).getByText("Which rules exist?")).toBeTruthy();
    expect(assistantApi.conversations[":sessionId"].$get).toHaveBeenCalledWith({
      param: { sessionId: SESSION_ID },
    });
  });

  it("disables the composer when the assistant is not available", async () => {
    const user = userEvent.setup();

    assistantApi.$get.mockImplementation(async () =>
      Response.json({ available: false, conversations: [] }),
    );

    const panel = await openPanel(user);

    expect(await within(panel).findByText(/assistant is not available/i)).toBeTruthy();
    expect((within(panel).getByLabelText("Message") as HTMLTextAreaElement).disabled).toBe(true);
  });
});
