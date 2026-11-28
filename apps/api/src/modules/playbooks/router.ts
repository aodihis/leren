import type { Db } from "@leren/db";
import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import type { z } from "@hono/zod-openapi";

import { errorSchema, fieldErrorsSchema, validationHook } from "../../validation";
import { requireUser } from "../auth/middleware";
import type { AuthVariables } from "../auth/middleware";
import type { Auth } from "../auth/service";
import {
  playbookEnabledSchema,
  playbookListQuerySchema,
  playbookListResponseSchema,
  playbookParamsSchema,
  playbookResponseSchema,
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

/**
 * Turns the error of a playbook whose account is missing or may not be used into its message, which
 * is written for the user, so that the route answers with a field error (decision 0044). Any other
 * error is thrown again.
 */
function describeAccountError(error: unknown): string {
  if (
    error instanceof ChannelAccountRequiredError ||
    error instanceof ChannelAccountUnavailableError
  ) {
    return error.message;
  }

  throw error;
}

/**
 * The body of a 400 answer for a rejected account. It has the type of the field errors that request
 * validation returns, so that a client sees one shape for every 400 of a playbook route.
 */
function accountFieldErrors(message: string): {
  fieldErrors: Record<string, string[] | undefined>;
} {
  return { fieldErrors: { channelAccountId: [message] } };
}

type Attempt<Value> = { ok: true; value: Value } | { ok: false; message: string };

/**
 * Runs a write and reports a rejected account as a message and not as an error, so that the route
 * can answer with a field error. Any other failure is thrown again.
 */
async function attempt<Value>(write: Promise<Value>): Promise<Attempt<Value>> {
  try {
    return { ok: true, value: await write };
  } catch (error) {
    return { ok: false, message: describeAccountError(error) };
  }
}

const tags = ["Playbooks"];
const security = [{ cookieAuth: [] }];

function json<Schema extends z.ZodType>(schema: Schema, description: string) {
  return { description, content: { "application/json": { schema } } };
}

const unauthorized = json(errorSchema, "There is no valid session.");
const notFound = json(errorSchema, "The playbook does not exist or belongs to another user.");
const invalid = json(fieldErrorsSchema, "The request is invalid. Each field lists its messages.");

const listRoute = createRoute({
  method: "get",
  path: "/api/playbooks",
  tags,
  security,
  summary: "List playbooks",
  request: { query: playbookListQuerySchema },
  responses: {
    200: json(playbookListResponseSchema, "The playbooks of the signed-in user."),
    400: invalid,
    401: unauthorized,
  },
});

const createPlaybookRoute = createRoute({
  method: "post",
  path: "/api/playbooks",
  tags,
  security,
  summary: "Create a playbook",
  request: {
    body: { required: true, content: { "application/json": { schema: playbookSchema } } },
  },
  responses: {
    201: json(playbookResponseSchema, "The created playbook."),
    400: invalid,
    401: unauthorized,
  },
});

const getRoute = createRoute({
  method: "get",
  path: "/api/playbooks/{id}",
  tags,
  security,
  summary: "Get a playbook",
  request: { params: playbookParamsSchema },
  responses: {
    200: json(playbookResponseSchema, "The playbook."),
    400: invalid,
    401: unauthorized,
    404: notFound,
  },
});

const replaceRoute = createRoute({
  method: "put",
  path: "/api/playbooks/{id}",
  tags,
  security,
  summary: "Replace a playbook",
  request: {
    params: playbookParamsSchema,
    body: { required: true, content: { "application/json": { schema: playbookSchema } } },
  },
  responses: {
    200: json(playbookResponseSchema, "The saved playbook."),
    400: invalid,
    401: unauthorized,
    404: notFound,
  },
});

const toggleRoute = createRoute({
  method: "patch",
  path: "/api/playbooks/{id}",
  tags,
  security,
  summary: "Turn a playbook on or off",
  request: {
    params: playbookParamsSchema,
    body: { required: true, content: { "application/json": { schema: playbookEnabledSchema } } },
  },
  responses: {
    200: json(playbookResponseSchema, "The saved playbook."),
    400: invalid,
    401: unauthorized,
    404: notFound,
  },
});

const deleteRoute = createRoute({
  method: "delete",
  path: "/api/playbooks/{id}",
  tags,
  security,
  summary: "Delete a playbook",
  request: { params: playbookParamsSchema },
  responses: {
    204: { description: "The playbook was deleted." },
    400: invalid,
    401: unauthorized,
    404: notFound,
  },
});

/**
 * Mounts the playbook routes under `/api/playbooks`. Every route requires a session and is scoped
 * to its user. After every written change, `requestIndex` asks for the playbook's vector index to
 * be updated.
 */
export function createPlaybooksRouter(
  auth: Auth,
  db: Db,
  requestIndex: (playbookId: string) => Promise<void>,
) {
  const router = new OpenAPIHono<{ Variables: AuthVariables }>({ defaultHook: validationHook });

  router.use("/api/playbooks/*", requireUser(auth));
  router.use("/api/playbooks", requireUser(auth));

  return router
    .openapi(listRoute, async (c) => {
      const playbooks = await listPlaybooks(db, c.get("userId"), c.req.valid("query"));

      return c.json({ playbooks }, 200);
    })
    .openapi(createPlaybookRoute, async (c) => {
      const created = await attempt(createPlaybook(db, c.get("userId"), c.req.valid("json")));

      if (!created.ok) {
        return c.json(accountFieldErrors(created.message), 400);
      }

      await requestIndex(created.value.id);

      return c.json({ playbook: created.value }, 201);
    })
    .openapi(getRoute, async (c) => {
      const playbook = await getPlaybook(db, c.get("userId"), c.req.valid("param").id);

      return playbook ? c.json({ playbook }, 200) : c.json({ error: "Not found" }, 404);
    })
    .openapi(replaceRoute, async (c) => {
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
    })
    .openapi(toggleRoute, async (c) => {
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
    })
    .openapi(deleteRoute, async (c) => {
      const { id } = c.req.valid("param");
      const deleted = await deletePlaybook(db, c.get("userId"), id);

      if (!deleted) {
        return c.json({ error: "Not found" }, 404);
      }

      await requestIndex(id);

      return c.body(null, 204);
    });
}
