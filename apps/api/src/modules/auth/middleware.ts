import { createMiddleware } from "hono/factory";

import type { Auth } from "./service";

export type AuthVariables = { userId: string };

/**
 * Rejects requests without a valid session with `401` and otherwise stores the session's user ID
 * as `userId` on the Hono context. Handlers must scope every query by that ID and never by an ID
 * taken from the request.
 */
export function requireUser(auth: Auth) {
  return createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });

    if (!session) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    c.set("userId", session.user.id);

    await next();
  });
}
