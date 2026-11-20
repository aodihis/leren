import type { Db } from "@leren/db";
import { Hono } from "hono";

import { validate } from "../../validation";
import { requireUser } from "../auth/middleware";
import type { AuthVariables } from "../auth/middleware";
import type { Auth } from "../auth/service";
import { autoReplyRuleSchema, ruleParamsSchema } from "./schema";
import { createRule, deleteRule, getRule, listRules, updateRule } from "./service";

/**
 * Mounts the CRUD routes of the signed-in user's auto-reply rules under `/api/auto-reply-rules`.
 * Every route requires a session and every query is scoped by the session's user, so a rule of
 * another user is reported as not found. The routes are chained so that the platform can infer
 * their types through Hono RPC.
 */
export function createAutoReplyRulesRouter(auth: Auth, db: Db) {
  return new Hono<{ Variables: AuthVariables }>()
    .use("/api/auto-reply-rules/*", requireUser(auth))
    .use("/api/auto-reply-rules", requireUser(auth))
    .get("/api/auto-reply-rules", async (c) => {
      return c.json({ rules: await listRules(db, c.get("userId")) }, 200);
    })
    .post("/api/auto-reply-rules", validate("json", autoReplyRuleSchema), async (c) => {
      const rule = await createRule(db, c.get("userId"), c.req.valid("json"));

      return c.json({ rule }, 201);
    })
    .get("/api/auto-reply-rules/:id", validate("param", ruleParamsSchema), async (c) => {
      const rule = await getRule(db, c.get("userId"), c.req.valid("param").id);

      return rule ? c.json({ rule }, 200) : c.json({ error: "Not found" }, 404);
    })
    .put(
      "/api/auto-reply-rules/:id",
      validate("param", ruleParamsSchema),
      validate("json", autoReplyRuleSchema),
      async (c) => {
        const rule = await updateRule(
          db,
          c.get("userId"),
          c.req.valid("param").id,
          c.req.valid("json"),
        );

        return rule ? c.json({ rule }, 200) : c.json({ error: "Not found" }, 404);
      },
    )
    .delete("/api/auto-reply-rules/:id", validate("param", ruleParamsSchema), async (c) => {
      const deleted = await deleteRule(db, c.get("userId"), c.req.valid("param").id);

      return deleted ? c.body(null, 204) : c.json({ error: "Not found" }, 404);
    });
}
