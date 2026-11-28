import type { Db } from "@leren/db";
import { Hono } from "hono";

import { validate } from "../../validation";
import { requireUser } from "../auth/middleware";
import type { AuthVariables } from "../auth/middleware";
import type { Auth } from "../auth/service";
import { overviewQuerySchema, reportParamsSchema } from "./schema";
import { getOverview, getPlaybookReport } from "./service";

/**
 * Mounts the read-only dashboard routes under `/api/dashboard` (decision 0048). Every route
 * requires a session and is scoped to its user, and the numbers are computed when they are read.
 */
export function createDashboardRouter(auth: Auth, db: Db) {
  return new Hono<{ Variables: AuthVariables }>()
    .use("/api/dashboard/*", requireUser(auth))
    .get("/api/dashboard/overview", validate("query", overviewQuerySchema), async (c) => {
      return c.json(await getOverview(db, c.get("userId"), c.req.valid("query").days), 200);
    })
    .get(
      "/api/dashboard/playbooks/:id/report",
      validate("param", reportParamsSchema),
      async (c) => {
        const result = await getPlaybookReport(db, c.get("userId"), c.req.valid("param").id);

        if (result.status === "not_found") {
          return c.json({ error: "Not found" }, 404);
        }

        if (result.status === "period_not_ended") {
          return c.json({ error: "period_not_ended" }, 409);
        }

        return c.json(result.report, 200);
      },
    );
}
