import type { Db } from "@leren/db";
import { Hono } from "hono";

import { validate } from "../../validation";
import { requireUser } from "./middleware";
import type { AuthVariables } from "./middleware";
import { updateProfileSchema } from "./schema";
import { getProfile, updateProfile } from "./service";
import type { Auth } from "./service";

/** Mounts the auth routes and the profile routes. */
export function createAuthRouter(auth: Auth, db: Db) {
  return new Hono<{ Variables: AuthVariables }>()
    .on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw))
    .get("/api/me", requireUser(auth), async (c) => {
      const profile = await getProfile(db, c.get("userId"));

      return profile ? c.json({ user: profile }, 200) : c.json({ error: "Unauthorized" }, 401);
    })
    .patch("/api/me", requireUser(auth), validate("json", updateProfileSchema), async (c) => {
      const profile = await updateProfile(db, c.get("userId"), c.req.valid("json"));

      return profile ? c.json({ user: profile }, 200) : c.json({ error: "Unauthorized" }, 401);
    });
}
