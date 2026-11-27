import { mcpSessions } from "@leren/db";
import type { Db } from "@leren/db";
import { and, eq, isNull } from "drizzle-orm";
import { SignJWT, jwtVerify } from "jose";

import { CLIENT_ROLES, ROLE_SCOPES, isScope } from "./scopes";
import type { ClientRole, Scope } from "./scopes";

/** How long a session lasts when the caller does not choose, in seconds. */
export const DEFAULT_SESSION_TTL_SECONDS = 15 * 60;

const MIN_SECRET_LENGTH = 32;

export type SessionDependencies = {
  db: Db;
  /** The HMAC secret that signs session tokens. */
  secret: string;
  now?: () => Date;
};

/**
 * A verified MCP session. Every value comes from the stored session row and not from the token, so
 * revoking or changing the row takes effect on the next call.
 */
export type McpSession = {
  id: string;
  userId: string;
  role: ClientRole;
  scopes: readonly Scope[];
  messageId: string | null;
  /**
   * The only playbooks that a reply session can read: the ones that the email gate allowed for its
   * message. It is null for every other role, whose sessions can read all of the user's playbooks.
   */
  playbookIds: readonly string[] | null;
  /** The label of an access token that a user created, and null for a session of a built-in agent. */
  name: string | null;
};

export type MintSessionInput = {
  userId: string;
  role: ClientRole;
  /** The scopes to grant. Defaults to every scope of the role and may not exceed it. */
  scopes?: readonly Scope[];
  /** The message a reply session is for. Required for the reply role and rejected for others. */
  messageId?: string;
  /**
   * The playbooks that the email gate allowed for the message of a reply session. Required for the
   * reply role and rejected for others. An empty list lets the session read no playbook.
   */
  playbookIds?: readonly string[];
  /** A label that marks the session as an access token that the user created and can list. */
  name?: string;
  ttlSeconds?: number;
};

export type MintedSession = {
  token: string;
  sessionId: string;
  expiresAt: Date;
};

function signingKey(secret: string): Uint8Array {
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`The MCP session secret must be at least ${MIN_SECRET_LENGTH} characters`);
  }

  return new TextEncoder().encode(secret);
}

/**
 * Creates a session row and returns a signed token for it. Throws when the request asks for a
 * scope outside the role, or when the message id does not fit the role.
 */
export async function mintSession(
  { db, secret, now = () => new Date() }: SessionDependencies,
  input: MintSessionInput,
): Promise<MintedSession> {
  const allowed = ROLE_SCOPES[input.role];
  const scopes = input.scopes ?? allowed;

  if (scopes.length === 0 || scopes.some((scope) => !allowed.includes(scope))) {
    throw new Error(`The scopes are not allowed for the ${input.role} role`);
  }

  if ((input.role === "reply") !== (input.messageId !== undefined)) {
    throw new Error("Only the reply role takes a message id, and it requires one");
  }

  if ((input.role === "reply") !== (input.playbookIds !== undefined)) {
    throw new Error("Only the reply role takes playbook ids, and it requires them");
  }

  const key = signingKey(secret);
  const issuedAt = now();

  const expiresAt = new Date(
    issuedAt.getTime() + (input.ttlSeconds ?? DEFAULT_SESSION_TTL_SECONDS) * 1000,
  );

  const [row] = await db
    .insert(mcpSessions)
    .values({
      userId: input.userId,
      role: input.role,
      scopes: [...scopes],
      messageId: input.messageId ?? null,
      playbookIds: input.playbookIds ? [...new Set(input.playbookIds)] : null,
      name: input.name ?? null,
      expiresAt,
    })
    .returning({ id: mcpSessions.id });

  const token = await new SignJWT({ role: input.role, scopes: [...scopes] })
    .setProtectedHeader({ alg: "HS256" })
    .setJti(row.id)
    .setSubject(input.userId)
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAt)
    .sign(key);

  return { token, sessionId: row.id, expiresAt };
}

/**
 * Returns the session a token stands for, or `null` for any reason it cannot be used: a bad
 * signature, an expired token, an unknown session, a session of another user, a revoked or expired
 * row, a token that claims scopes the row does not grant, or a reply session without the list of
 * playbooks it may read. The caller cannot tell which. The last check makes a reply session fail
 * closed, so it never reads every playbook of the user.
 */
export async function verifySession(
  { db, secret, now = () => new Date() }: SessionDependencies,
  token: string,
): Promise<McpSession | null> {
  const key = signingKey(secret);
  const current = now();

  const payload = await jwtVerify(token, key, { algorithms: ["HS256"], currentDate: current })
    .then((result) => result.payload)
    .catch(() => null);

  if (!payload?.jti || !payload.sub) {
    return null;
  }

  const [row] = await db
    .select()
    .from(mcpSessions)
    .where(
      and(
        eq(mcpSessions.id, payload.jti),
        eq(mcpSessions.userId, payload.sub),
        isNull(mcpSessions.revokedAt),
      ),
    );

  if (!row || row.expiresAt <= current || !CLIENT_ROLES.includes(row.role)) {
    return null;
  }

  if ((row.role === "reply") !== (row.playbookIds !== null)) {
    return null;
  }

  const claimed = Array.isArray(payload.scopes) ? payload.scopes : [];
  const granted = row.scopes.filter(isScope);

  if (claimed.some((scope) => !granted.includes(scope))) {
    return null;
  }

  return {
    id: row.id,
    userId: row.userId,
    role: row.role,
    scopes: granted,
    messageId: row.messageId,
    playbookIds: row.playbookIds,
    name: row.name,
  };
}

/**
 * Revokes one session of `userId`. Returns `false` when the session does not exist, belongs to
 * another user or is already revoked, and the cases are indistinguishable.
 */
export async function revokeSession(
  { db, now = () => new Date() }: Pick<SessionDependencies, "db" | "now">,
  userId: string,
  sessionId: string,
): Promise<boolean> {
  const revoked = await db
    .update(mcpSessions)
    .set({ revokedAt: now() })
    .where(
      and(
        eq(mcpSessions.id, sessionId),
        eq(mcpSessions.userId, userId),
        isNull(mcpSessions.revokedAt),
      ),
    )
    .returning({ id: mcpSessions.id });

  return revoked.length > 0;
}
