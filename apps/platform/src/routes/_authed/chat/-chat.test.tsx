import { agentToClientStream } from "@anvia/client";
import { Agent } from "@anvia/core";
import { createClientStreamResponse } from "@anvia/server";
import { createFakeModel } from "@leren/agents/testing";
import type { FakeStep } from "@leren/agents/testing";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authClient = vi.hoisted(() => ({ getSession: vi.fn() }));

const assistantApi = vi.hoisted(() => ({
  $get: vi.fn(),
  conversations: { ":sessionId": { $get: vi.fn(), $delete: vi.fn() } },
}));

vi.mock("../../../modules/auth/auth-client", () => ({ authClient }));

vi.mock("../../../modules/api/api-client", () => ({ api: { api: { assistant: assistantApi } } }));

import { renderApp } from "../../../testing";

const SESSION_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_ID = "44444444-4444-4444-8444-444444444444";

const history = [
  { id: SESSION_ID, title: "Vacation rules", updatedAt: "2026-11-21" },
  { id: OTHER_ID, title: "Launch dates", updatedAt: "2026-11-20" },
];

/** A stand-in for the chat endpoint. */
function stubChatEndpoint(steps: readonly FakeStep[]) {
  const agent = new Agent({
    id: "assistant",
    model: createFakeModel(steps),
    instructions: "Help.",
    maxTurns: 5,
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

describe("chat page", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    assistantApi.$get.mockImplementation(async () =>
      Response.json({ available: true, conversations: history }),
    );
    assistantApi.conversations[":sessionId"].$get.mockImplementation(async () =>
      Response.json({ messages: [] }),
    );
    authClient.getSession.mockResolvedValue({
      data: {
        user: { id: "u1", name: "Ada Lovelace", firstName: "Ada", email: "ada@example.com" },
      },
      error: null,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts a new chat at an address of its own, with a welcome screen", async () => {
    const router = await renderApp("/chat");

    expect(router.state.location.pathname).toMatch(/^\/chat\/[\w-]{36}$/);
    expect(await screen.findByRole("heading", { name: "Hello, Ada" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add knowledge" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "New chat" })).toBeTruthy();
  });

  it("lists the history under the menu and marks the open chat", async () => {
    assistantApi.conversations[":sessionId"].$get.mockImplementation(async () =>
      Response.json({ messages: [{ role: "user", content: "Which rules exist?" }] }),
    );

    await renderApp(`/chat/${SESSION_ID}`);

    const chats = await screen.findByRole("region", { name: "Chats" });
    const open = within(chats).getByRole("link", { name: "Vacation rules" });

    expect(within(chats).getByRole("link", { name: "Launch dates" })).toBeTruthy();
    expect(open.getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "New chat" }).getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("link", { name: "Playbooks" }).getAttribute("aria-current")).toBeNull();
    expect(await screen.findByText("Which rules exist?")).toBeTruthy();
  });

  it("streams an answer, sends the title, and refreshes the history when the run ends", async () => {
    const user = userEvent.setup();
    const fetchStub = stubChatEndpoint([{ text: "Hi there" }]);
    const router = await renderApp("/chat");
    const sessionId = router.state.location.pathname.split("/").at(-1);
    const loadsBefore = assistantApi.$get.mock.calls.length;

    await user.type(await screen.findByLabelText("Message"), "Hello");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("Hi there")).toBeTruthy();
    expect(String(fetchStub.mock.calls[0][0])).toBe(`/api/assistant/chat?sessionId=${sessionId}`);
    expect(JSON.parse(String(fetchStub.mock.calls[0][1].body)).messages.at(-1).metadata).toEqual({
      title: "Hello",
    });
    expect(assistantApi.$get.mock.calls.length).toBeGreaterThan(loadsBefore);
    expect(screen.queryByRole("heading", { name: /Hello, Ada/ })).toBeNull();
  });

  it("sends a starter card as the first message", async () => {
    const user = userEvent.setup();
    const fetchStub = stubChatEndpoint([{ text: "You have no rules yet." }]);

    await renderApp("/chat");
    await user.click(await screen.findByRole("button", { name: "See my rules" }));

    expect(await screen.findByText("You have no rules yet.")).toBeTruthy();
    expect(JSON.parse(String(fetchStub.mock.calls[0][1].body)).messages.at(-1).content).toEqual([
      { type: "text", text: "What rules do I have?" },
    ]);
  });

  it("deletes a chat from the history and starts a new one when it was open", async () => {
    const user = userEvent.setup();

    assistantApi.conversations[":sessionId"].$delete.mockResolvedValue(
      new Response(null, { status: 204 }),
    );

    const router = await renderApp(`/chat/${SESSION_ID}`);

    await user.click(await screen.findByRole("button", { name: "Delete chat Vacation rules" }));

    expect(assistantApi.conversations[":sessionId"].$delete).toHaveBeenCalledWith({
      param: { sessionId: SESSION_ID },
    });
    await vi.waitFor(() => expect(router.state.location.pathname).not.toBe(`/chat/${SESSION_ID}`));
    expect(router.state.location.pathname).toMatch(/^\/chat\/[\w-]{36}$/);
  });

  it("disables the composer when the assistant is not available", async () => {
    assistantApi.$get.mockImplementation(async () =>
      Response.json({ available: false, conversations: [] }),
    );

    await renderApp("/chat");

    expect(await screen.findByText(/assistant is not available/i)).toBeTruthy();
    expect((screen.getByLabelText("Message") as HTMLTextAreaElement).disabled).toBe(true);
  });
});
