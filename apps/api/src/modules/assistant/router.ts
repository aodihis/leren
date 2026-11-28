import { agentToClientStream, parseClientStreamRequest } from "@anvia/client";
import { createClientStreamResponse } from "@anvia/server";
import type { Message } from "@anvia/core";
import type { Db } from "@leren/db";
import type { Logger } from "@leren/logger";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

import { validate } from "../../validation";
import { requireUser } from "../auth/middleware";
import type { AuthVariables } from "../auth/middleware";
import type { Auth } from "../auth/service";
import type { Agent } from "./agent";
import {
  MAX_MESSAGE_LENGTH,
  chatMetadataSchema,
  chatQuerySchema,
  sessionParamsSchema,
} from "./schema";
import {
  createMemoryStore,
  deleteConversation,
  listConversations,
  loadMessages,
  scopeFor,
} from "./service";

export type AssistantRouterDependencies = {
  auth: Auth;
  db: Db;
  logger: Logger;
  /** Runs the Assistant Agent. Without it the chat is unavailable and the other routes still work. */
  agent?: Agent | undefined;
};

const MAX_BODY_BYTES = 256 * 1024;

/** The plain text of a message, or `null` when it has parts other than text. */
function textOf(content: Message["content"]): string | null {
  if (typeof content === "string") {
    return content;
  }

  const texts = content.map((part) => (part.type === "text" ? part.text : null));

  return texts.includes(null) ? null : texts.join("");
}

/**
 * Mounts the assistant chat routes under `/api/assistant`. Every route requires a session and is
 * scoped to its user. `POST /chat?sessionId=` speaks Anvia's client stream protocol, and the
 * conversation is the agent's memory. The status is 200 before the agent runs, so every failed run
 * is logged here.
 */
export function createAssistantRouter({ auth, db, logger, agent }: AssistantRouterDependencies) {
  const running = new Set<string>();
  let memory: ReturnType<typeof createMemoryStore> | undefined;

  const getStore = () => (memory ??= createMemoryStore(db));

  return new Hono<{ Variables: AuthVariables }>()
    .use("/api/assistant/*", requireUser(auth))
    .use("/api/assistant", requireUser(auth))
    .get("/api/assistant", async (c) => {
      const conversations = await listConversations(getStore(), c.get("userId"));

      return c.json({ available: agent !== undefined, conversations }, 200);
    })
    .get(
      "/api/assistant/conversations/:sessionId",
      validate("param", sessionParamsSchema),
      async (c) => {
        const messages = await loadMessages(
          getStore(),
          c.get("userId"),
          c.req.valid("param").sessionId,
        );

        return c.json({ messages }, 200);
      },
    )
    .delete(
      "/api/assistant/conversations/:sessionId",
      validate("param", sessionParamsSchema),
      async (c) => {
        await deleteConversation(getStore(), c.get("userId"), c.req.valid("param").sessionId);

        return c.body(null, 204);
      },
    )
    .post(
      "/api/assistant/chat",
      bodyLimit({
        maxSize: MAX_BODY_BYTES,
        onError: (c) => c.json({ error: "The request is too large" }, 413),
      }),
      validate("query", chatQuerySchema),
      async (c) => {
        if (!agent) {
          return c.json({ error: "The assistant is not available" }, 503);
        }

        const body = await c.req
          .json()
          .then(parseClientStreamRequest)
          .catch(() => null);

        if (body?.type !== "messages") {
          return c.json({ error: "This endpoint accepts chat messages only" }, 400);
        }

        const last = body.messages.at(-1);
        const text = last?.role === "user" ? textOf(last.content) : null;

        if (!last || text === null || !text.trim() || text.length > MAX_MESSAGE_LENGTH) {
          return c.json({ error: "Send a text message of at most 4000 characters" }, 400);
        }

        const userId = c.get("userId");
        const { sessionId } = c.req.valid("query");
        const title = chatMetadataSchema.safeParse(last.metadata ?? {}).data?.title;

        const key = `${userId}:${sessionId}`;
        const runLogger = logger.child({ userId, sessionId });

        if (running.has(key)) {
          return c.json({ error: "This chat is already answering" }, 409);
        }

        running.add(key);

        const { messages } = body;
        const run = agent;

        async function* untilDone() {
          try {
            for await (const event of run({
              userId,
              messages,
              memory: { store: getStore(), session: scopeFor(userId, sessionId, title) },
              abortSignal: c.req.raw.signal,
            })) {
              if (event.type === "error") {
                runLogger.error("The assistant run reported an error", { error: event.error });
              }

              yield event;
            }
          } catch (error) {
            runLogger.error("The assistant run failed", { error });

            throw error;
          } finally {
            running.delete(key);
          }
        }

        const events = agentToClientStream({ events: untilDone() });

        return createClientStreamResponse({ events });
      },
    );
}
