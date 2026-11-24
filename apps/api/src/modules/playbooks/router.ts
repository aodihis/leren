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
  ChannelAccountRequiredError,
  ChannelAccountUnavailableError,
  createPlaybook,
  deletePlaybook,
  getPlaybook,
  listPlaybooks,
  setPlaybookEnabled,
  updatePlaybook,
} from "./service";

/** Turns an account error into a user message. */
function describeAccountError(error: unknown): string {
  if (
    error instanceof ChannelAccountRequiredError ||
    error instanceof ChannelAccountUnavailableError
  ) {
    return error.message;
  }

  throw error;
}

/** The body of a 400 answer for a rejected account. */
function accountFieldErrors(message: string): {
  fieldErrors: Record<string, string[] | undefined>;
} {
  return { fieldErrors: { channelAccountId: [message] } };
}

type Attempt<Value> = { ok: true; value: Value } | { ok: false; message: string };

/** Runs a write and reports a rejected account. */
async function attempt<Value>(write: Promise<Value>): Promise<Attempt<Value>> {
  try {
    return { ok: true, value: await write };
  } catch (error) {
    return { ok: false, message: describeAccountError(error) };
  }
}

/** Mounts the playbook routes. */
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
      const created = await attempt(createPlaybook(db, c.get("userId"), c.req.valid("json")));

      if (!created.ok) {
        return c.json(accountFieldErrors(created.message), 400);
      }

      await requestIndex(created.value.id);

      return c.json({ playbook: created.value }, 201);
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
        const updated = await attempt(
          updatePlaybook(db, c.get("userId"), c.req.valid("param").id, c.req.valid("json")),
        );

        if (!updated.ok) {
          return c.json(accountFieldErrors(updated.message), 400);
        }

        if (updated.value.status !== "saved") {
          return c.json({ error: "Not found" }, 404);
        }

        await requestIndex(updated.value.playbook.id);

        return c.json({ playbook: updated.value.playbook }, 200);
      },
    )
    .patch(
      "/api/playbooks/:id",
      validate("param", playbookParamsSchema),
      validate("json", playbookEnabledSchema),
      async (c) => {
        const toggled = await attempt(
          setPlaybookEnabled(
            db,
            c.get("userId"),
            c.req.valid("param").id,
            c.req.valid("json").enabled,
          ),
        );

        if (!toggled.ok) {
          return c.json(accountFieldErrors(toggled.message), 400);
        }

        if (toggled.value.status !== "saved") {
          return c.json({ error: "Not found" }, 404);
        }

        await requestIndex(toggled.value.playbook.id);

        return c.json({ playbook: toggled.value.playbook }, 200);
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
