import type { Db } from "@leren/db";
import { Hono } from "hono";

import { requireUser } from "./middleware";
import type { AuthVariables } from "./middleware";
import { getProfile } from "./service";
import type { Auth } from "./service";

/**
 * Mounts Better Auth's endpoints under `/api/auth` and adds `GET /api/me`, which returns the
 * signed-in user's profile.
 */
export function createAuthRouter(auth: Auth, db: Db) {
  const router = new Hono<{ Variables: AuthVariables }>();

  router.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

  router.get("/api/me", requireUser(auth), async (c) => {
    const profile = await getProfile(db, c.get("userId"));

    return profile ? c.json({ user: profile }) : c.json({ error: "Unauthorized" }, 401);
  });

  return router;
}
