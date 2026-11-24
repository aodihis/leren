import { DrizzleMemoryStore } from "@anvia/memory-drizzle";
import type { MemoryScope, Message } from "@anvia/core";
import type { Db } from "@leren/db";

import { MAX_TITLE_LENGTH } from "./schema";

const AGENT = "assistant";
const LIST_LIMIT = 100;
const DEFAULT_TITLE = "New chat";

/** Creates the store of assistant conversations. */
export function createMemoryStore(db: Db): DrizzleMemoryStore {
  return new DrizzleMemoryStore({ db, scopeKey: { includeUserId: true } });
}

/** The memory scope of one conversation of one user. */
export function scopeFor(userId: string, sessionId: string, title?: string): MemoryScope {
  return {
    sessionId,
    userId,
    metadata: { agent: AGENT, title: (title ?? DEFAULT_TITLE).slice(0, MAX_TITLE_LENGTH) },
  };
}

/** The user's most recent assistant conversations. */
export async function listConversations(store: DrizzleMemoryStore, userId: string) {
  const summaries = await store.inspector.listConversations({ limit: LIST_LIMIT, userId });

  return summaries.flatMap((summary) =>
    summary.metadata?.agent === AGENT
      ? [
          {
            id: summary.sessionId,
            title: String(summary.metadata.title ?? DEFAULT_TITLE),
            updatedAt: summary.updatedAt,
          },
        ]
      : [],
  );
}

/** The stored messages of a conversation. */
export function loadMessages(
  store: DrizzleMemoryStore,
  userId: string,
  sessionId: string,
): Promise<Message[]> {
  return store.load({ scope: { sessionId, userId } });
}

/** Deletes a conversation's history. */
export function deleteConversation(
  store: DrizzleMemoryStore,
  userId: string,
  sessionId: string,
): Promise<void> {
  return store.clear({ scope: { sessionId, userId } });
}
