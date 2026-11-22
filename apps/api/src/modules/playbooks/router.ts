import type { Db } from "@leren/db";
import { Hono } from "hono";

import { validate } from "../../validation";
import { requireUser } from "../auth/middleware";
import type { AuthVariables } from "../auth/middleware";
import type { Auth } from "../auth/service";
import {
  playbookListQuerySchema,
  playbookEnabledSchema,
  playbookParamsSchema,
  playbookSchema,
} from "./schema";
import {
  createPlaybook,
  deletePlaybook,
  getPlaybook,
  listPlaybooks,
  setPlaybookEnabled,
  updatePlaybook,
} from "./service";

/**
 * Mounts the routes of the signed-in user's playbooks under `/api/playbooks`. Every route requires
 * a session and every query is scoped by the session's user, so a playbook of another user is
 * reported as not found. `PATCH /api/playbooks/:id` turns a playbook on or off. After every change
 * that was written, `requestIndex` asks for the vector index of the playbook to be updated. The routes are chained so that the platform
 * can infer their types through Hono RPC.
 */
export function createPlaybooksRouter(
  auth: Auth,
  db: Db,
  requestIndex: (playbookId: string) => Promise<void>,
) {
  return new Hono<{ Variables: AuthVariables }>()
    .use("/api/playbooks/*", requireUser(auth))
    .use("/api/playbooks", requireUser(auth))
    .get("/api/playbooks", validate("query", playbookListQuerySchema), async (c) => {
      const playbooks = await listPlaybooks(db, c.get("userId"), c.req.valid("query"));

      return c.json({ playbooks }, 200);
    })
    .post("/api/playbooks", validate("json", playbookSchema), async (c) => {
      const playbook = await createPlaybook(db, c.get("userId"), c.req.valid("json"));

      await requestIndex(playbook.id);

      return c.json({ playbook }, 201);
    })
    .get("/api/playbooks/:id", validate("param", playbookParamsSchema), async (c) => {
      const playbook = await getPlaybook(db, c.get("userId"), c.req.valid("param").id);

      return playbook ? c.json({ playbook }, 200) : c.json({ error: "Not found" }, 404);
    })
    .put(
      "/api/playbooks/:id",
      validate("param", playbookParamsSchema),
      validate("json", playbookSchema),
      async (c) => {
        const result = await updatePlaybook(
          db,
          c.get("userId"),
          c.req.valid("param").id,
          c.req.valid("json"),
        );

        if (result.status !== "saved") {
          return c.json({ error: "Not found" }, 404);
        }

        await requestIndex(result.playbook.id);

        return c.json({ playbook: result.playbook }, 200);
      },
    )
    .patch(
      "/api/playbooks/:id",
      validate("param", playbookParamsSchema),
      validate("json", playbookEnabledSchema),
      async (c) => {
        const result = await setPlaybookEnabled(
          db,
          c.get("userId"),
          c.req.valid("param").id,
          c.req.valid("json").enabled,
        );

        if (result.status !== "saved") {
          return c.json({ error: "Not found" }, 404);
        }

        await requestIndex(result.playbook.id);

        return c.json({ playbook: result.playbook }, 200);
      },
    )
    .delete("/api/playbooks/:id", validate("param", playbookParamsSchema), async (c) => {
      const { id } = c.req.valid("param");
      const deleted = await deletePlaybook(db, c.get("userId"), id);

      if (!deleted) {
        return c.json({ error: "Not found" }, 404);
      }

      await requestIndex(id);

      return c.body(null, 204);
    });
}
