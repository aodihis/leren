import type { Db } from "@leren/db";
import type { InboundEmail, RecordResult } from "@leren/inbox";
import { Hono } from "hono";

import { validate } from "../../validation";
import { requireUser } from "../auth/middleware";
import type { AuthVariables } from "../auth/middleware";
import type { Auth } from "../auth/service";
import { messageListQuerySchema, messageParamsSchema, simulateEmailSchema } from "./schema";
import { buildSimulatedEmail, getMessage, listMessages } from "./service";

/**
 * What the router needs beyond the database. `recordEmail` records an email and publishes it to
 * the gate. `simulate` turns on the route that records a simulated email.
 */
export type MessagesRouterDependencies = {
  recordEmail: (email: InboundEmail) => Promise<RecordResult>;
  simulate: boolean;
};

/** The dependencies of an API without an inbox. The simulation route answers with not found. */
export const NO_INBOX: MessagesRouterDependencies = {
  recordEmail: async () => {
    throw new Error("No inbox is configured");
  },
  simulate: false,
};

/**
 * Mounts the read-only message record routes under `/api/messages`. Every route requires a session
 * and is scoped to its user. `POST /simulate` exists only when `simulate` is set, which is while
 * the development provider is enabled (decision 0039).
 */
export function createMessagesRouter({
  auth,
  db,
  dependencies,
}: {
  auth: Auth;
  db: Db;
  dependencies: MessagesRouterDependencies;
}) {
  return new Hono<{ Variables: AuthVariables }>()
    .use("/api/messages/*", requireUser(auth))
    .use("/api/messages", requireUser(auth))
    .get("/api/messages", validate("query", messageListQuerySchema), async (c) => {
      return c.json(await listMessages(db, c.get("userId"), c.req.valid("query")), 200);
    })
    .post(
      "/api/messages/simulate",
      async (c, next) => {
        if (!dependencies.simulate) {
          return c.json({ error: "Not found" }, 404);
        }

        await next();
      },
      validate("json", simulateEmailSchema),
      async (c) => {
        const email = await buildSimulatedEmail(db, c.get("userId"), c.req.valid("json"));

        if (!email) {
          return c.json({ error: "no_account" }, 409);
        }

        return c.json(await dependencies.recordEmail(email), 201);
      },
    )
    .get("/api/messages/:id", validate("param", messageParamsSchema), async (c) => {
      const message = await getMessage(db, c.get("userId"), c.req.valid("param").id);

      return message ? c.json(message, 200) : c.json({ error: "Not found" }, 404);
    });
}
