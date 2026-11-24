import { mcpSessions } from "@leren/db";
import type { Db } from "@leren/db";
import { ROLE_SCOPES, mintSession } from "@leren/mcp-server";
import type { SessionDependencies } from "@leren/mcp-server";
import { and, desc, eq, gt, isNotNull, isNull } from "drizzle-orm";

import type { CreateAccessTokenInput } from "./schema";

/** The most access tokens that a user can hold at once. Expired and revoked tokens do not count. */
export const ACCESS_TOKEN_LIMIT = 10;

const SECONDS_PER_DAY = 24 * 60 * 60;

export type AccessTokenView = {
  id: string;
  name: string;
  access: "read" | "write";
  createdAt: string;
  expiresAt: string;
};

type SessionRow = typeof mcpSessions.$inferSelect;

function toView(row: SessionRow): AccessTokenView {
  return {
    id: row.id,
    name: row.name ?? "",
    access: row.scopes.includes("playbooks:write") ? "write" : "read",
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  };
}

/**
 * Lists the user's access tokens that can still authenticate: named sessions that have not
 * expired and are not revoked. The token itself is never stored, so it is not part of the list.
 */
export async function listAccessTokens(
  db: Db,
  userId: string,
  now = new Date(),
): Promise<AccessTokenView[]> {
  const rows = await db
    .select()
    .from(mcpSessions)
    .where(
      and(
        eq(mcpSessions.userId, userId),
        isNotNull(mcpSessions.name),
        isNull(mcpSessions.revokedAt),
        gt(mcpSessions.expiresAt, now),
      ),
    )
    .orderBy(desc(mcpSessions.createdAt));

  return rows.map(toView);
}

/**
 * Mints an access token for the user with the `assistant` role. The role is the ceiling: the `read`
 * level grants only the read scope. Returns `limit` when the user already holds the most tokens.
 * The token is returned here and cannot be read again.
 */
export async function createAccessToken(
  sessions: SessionDependencies,
  userId: string,
  input: CreateAccessTokenInput,
): Promise<{ status: "limit" } | { status: "created"; token: string; view: AccessTokenView }> {
  const active = await listAccessTokens(sessions.db, userId, sessions.now?.());

  if (active.length >= ACCESS_TOKEN_LIMIT) {
    return { status: "limit" };
  }

  const minted = await mintSession(sessions, {
    userId,
    role: "assistant",
    scopes: input.access === "write" ? ROLE_SCOPES.assistant : ["playbooks:read"],
    name: input.name,
    ttlSeconds: input.expiresInDays * SECONDS_PER_DAY,
  });

  return {
    status: "created",
    token: minted.token,
    view: {
      id: minted.sessionId,
      name: input.name,
      access: input.access,
      createdAt: (sessions.now?.() ?? new Date()).toISOString(),
      expiresAt: minted.expiresAt.toISOString(),
    },
  };
}
