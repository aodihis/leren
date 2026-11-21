import { randomUUID } from "node:crypto";

import { runAgent } from "@leren/assistant-agent";
import { createFakeModel } from "@leren/agents/testing";
import type { FakeStep } from "@leren/agents/testing";
import { createTestDatabase } from "@leren/db/testing";
import type { TestDatabase } from "@leren/db/testing";
import { createInMemoryEmailSender } from "@leren/email/testing";
import type { InMemoryEmailSender } from "@leren/email/testing";
import type { Logger } from "@leren/logger";
import { createNoopObserver } from "@leren/observability";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createApp } from "../../app";
import { createAuth } from "../auth/service";
import type { Agent } from "./agent";

const ORIGIN = "http://localhost:5173";

type StreamEvent = { type: string; delta?: string; status?: string };

const chatPath = (sessionId: string) => `/api/assistant/chat?sessionId=${sessionId}`;

const conversationPath = (sessionId: string) => `/api/assistant/conversations/${sessionId}`;

const userMessage = (text: string, title?: string) => ({
  type: "messages",
  messages: [{ role: "user", content: text, metadata: title ? { title } : undefined }],
});

function createSilentLogger(): Logger {
  const logger: Logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: () => logger,
  };

  return logger;
}

/** Reads the events of a framed JSONL chat response. */
async function readEvents(response: Response): Promise<StreamEvent[]> {
  const lines = (await response.text()).split("\n").filter(Boolean);

  return lines
    .map((line) => JSON.parse(line) as { type: string; event?: StreamEvent })
    .flatMap((frame) => (frame.type === "stream_event" && frame.event ? [frame.event] : []));
}

function textOf(events: StreamEvent[]): string {
  return events.flatMap((event) => (event.type === "text_delta" ? [event.delta] : [])).join("");
}

/** An agent that runs the real Assistant Agent against a scripted model. */
function createScriptedAgent(steps: readonly FakeStep[]): Agent {
  const model = createFakeModel(steps);

  return (input) =>
    runAgent({
      instructions: "Help with rules.",
      model,
      observer: createNoopObserver(),
      messages: input.messages,
      memory: input.memory,
      abortSignal: input.abortSignal,
    });
}

describe("assistant chat API", () => {
  let database: TestDatabase;
  let sender: InMemoryEmailSender;
  let auth: ReturnType<typeof createAuth>;

  const buildApp = (agent?: Agent) =>
    createApp({
      auth,
      db: database.db,
      logger: createSilentLogger(),
      requestKnowledgeIndex: vi.fn(),
      assistant: agent,
      mcp: { secret: "an-mcp-test-secret-of-at-least-32-chars" },
    });

  type TestApp = ReturnType<typeof buildApp>;

  const send = (app: TestApp, path: string, body: unknown, cookie = "") =>
    app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN, cookie },
      body: JSON.stringify(body),
    });

  const get = (app: TestApp, path: string, cookie: string) =>
    app.request(path, { headers: { cookie } });

  const signIn = async (app: TestApp, email: string) => {
    await send(app, "/api/auth/email-otp/send-verification-otp", { email, type: "sign-in" });

    const otp = /\b\d{6}\b/.exec(sender.sent.at(-1)?.text ?? "")?.[0];
    const response = await send(app, "/api/auth/sign-in/email-otp", { email, otp });

    return response.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
  };

  beforeAll(async () => {
    database = await createTestDatabase();
    sender = createInMemoryEmailSender();

    auth = createAuth({
      db: database.db,
      emailSender: sender,
      logger: createSilentLogger(),
      secret: "test-secret-test-secret-test-secret-1234",
      baseURL: "http://localhost:3000",
      trustedOrigins: [ORIGIN],
    });
  });

  afterAll(async () => {
    await database.drop();
  });

  it("requires a session", async () => {
    const app = buildApp();

    expect((await app.request("/api/assistant")).status).toBe(401);
    expect((await send(app, chatPath(randomUUID()), userMessage("Hi"))).status).toBe(401);
  });

  it("reports the assistant as unavailable without an agent", async () => {
    const app = buildApp();
    const cookie = await signIn(app, "off@example.com");

    expect(await (await get(app, "/api/assistant", cookie)).json()).toEqual({
      available: false,
      conversations: [],
    });
    expect((await send(app, chatPath(randomUUID()), userMessage("Hi"), cookie)).status).toBe(503);
  });

  it("rejects a request that is not a chat message", async () => {
    const app = buildApp(createScriptedAgent([{ text: "Hello" }]));
    const cookie = await signIn(app, "invalid@example.com");
    const path = chatPath(randomUUID());
    const fromAssistant = { type: "messages", messages: [{ role: "assistant", content: "Hi" }] };

    expect((await send(app, "/api/assistant/chat", userMessage("Hi"), cookie)).status).toBe(400);
    expect((await send(app, path, { nonsense: true }, cookie)).status).toBe(400);
    expect((await send(app, path, fromAssistant, cookie)).status).toBe(400);
    expect((await send(app, path, userMessage("x".repeat(4001)), cookie)).status).toBe(400);
  });

  it("rejects an oversized request body and a second run on a busy chat", async () => {
    const app = buildApp(createScriptedAgent([{ text: "Hello" }, { text: "Again" }]));
    const cookie = await signIn(app, "limits@example.com");
    const sessionId = randomUUID();
    const huge = userMessage("x".repeat(300_000));

    expect((await send(app, chatPath(sessionId), huge, cookie)).status).toBe(413);

    const first = await send(app, chatPath(sessionId), userMessage("Hi"), cookie);
    const second = await send(app, chatPath(sessionId), userMessage("Hi again"), cookie);

    expect(second.status).toBe(409);

    await readEvents(first);

    expect((await send(app, chatPath(sessionId), userMessage("Hi again"), cookie)).status).toBe(
      200,
    );
  });

  it("answers a message and keeps the conversation as history", async () => {
    const app = buildApp(createScriptedAgent([{ text: "Hello there" }, { text: "Again" }]));
    const cookie = await signIn(app, "chat@example.com");
    const sessionId = randomUUID();

    const first = await readEvents(
      await send(app, chatPath(sessionId), userMessage("Hi", "Greeting"), cookie),
    );

    expect(textOf(first)).toBe("Hello there");
    expect(first.at(-1)).toMatchObject({ type: "run_end", status: "completed" });

    const history = [
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello there" },
      { role: "user", content: "And again", metadata: { title: "Greeting" } },
    ];

    const second = await send(
      app,
      chatPath(sessionId),
      { type: "messages", messages: history },
      cookie,
    );

    expect(textOf(await readEvents(second))).toBe("Again");

    const stored = await (await get(app, conversationPath(sessionId), cookie)).json();

    expect(stored.messages.map((message: { role: string }) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);

    const list = await (await get(app, "/api/assistant", cookie)).json();

    expect(list.conversations).toEqual([
      { id: sessionId, title: "Greeting", updatedAt: expect.any(String) },
    ]);
  });

  it("reports a failed run without exposing the error", async () => {
    const app = buildApp(createScriptedAgent([]));
    const cookie = await signIn(app, "broken@example.com");

    const events = await readEvents(
      await send(app, chatPath(randomUUID()), userMessage("Hi"), cookie),
    );

    expect(events.at(-1)).toMatchObject({ type: "run_end", status: "error" });
    expect(JSON.stringify(events)).not.toContain("no scripted step");
  });

  it("keeps conversations private to their user", async () => {
    const app = buildApp(createScriptedAgent([{ text: "Hello" }, { text: "Hi other" }]));
    const owner = await signIn(app, "owner@example.com");
    const other = await signIn(app, "other@example.com");
    const sessionId = randomUUID();

    await readEvents(await send(app, chatPath(sessionId), userMessage("Secret plan"), owner));

    expect((await get(app, conversationPath(sessionId), other)).status).toBe(404);
    expect((await (await get(app, "/api/assistant", other)).json()).conversations).toEqual([]);

    await readEvents(await send(app, chatPath(sessionId), userMessage("Hello"), other));

    const stored = await (await get(app, conversationPath(sessionId), other)).json();

    expect(JSON.stringify(stored)).not.toContain("Secret plan");

    await app.request(conversationPath(sessionId), {
      method: "DELETE",
      headers: { cookie: other },
    });

    expect((await get(app, conversationPath(sessionId), owner)).status).toBe(200);
  });

  it("deletes a conversation with its history", async () => {
    const app = buildApp(createScriptedAgent([{ text: "Hello" }]));
    const cookie = await signIn(app, "deleter@example.com");
    const sessionId = randomUUID();

    await readEvents(await send(app, chatPath(sessionId), userMessage("Hi"), cookie));

    const deleted = await app.request(conversationPath(sessionId), {
      method: "DELETE",
      headers: { cookie },
    });

    expect(deleted.status).toBe(204);
    expect((await get(app, conversationPath(sessionId), cookie)).status).toBe(404);
    expect((await (await get(app, "/api/assistant", cookie)).json()).conversations).toEqual([]);
  });
});
