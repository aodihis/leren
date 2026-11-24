import { createMiddleware } from "hono/factory";

import type { Auth } from "./service";

export type AuthVariables = { userId: string };

/** Rejects requests without a valid session. */
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
