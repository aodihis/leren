import type { Db } from "@leren/db";
import { Hono } from "hono";

import { validate } from "../../validation";
import { requireUser } from "../auth/middleware";
import type { AuthVariables } from "../auth/middleware";
import type { Auth } from "../auth/service";
import { contactParamsSchema, contactSchema } from "./schema";
import { createContact, deleteContact, listContacts, updateContact } from "./service";

const DUPLICATE_ERRORS: { fieldErrors: Record<string, string[] | undefined> } = {
  fieldErrors: { email: ["You already have a contact with this address"] },
};

/**
 * Mounts the routes of the signed-in user's contacts under `/api/contacts`. Every route requires a
 * session and every query is scoped by the session's user, so a contact of another user is
 * reported as not found.
 */
export function createContactsRouter(auth: Auth, db: Db) {
  return new Hono<{ Variables: AuthVariables }>()
    .use("/api/contacts/*", requireUser(auth))
    .use("/api/contacts", requireUser(auth))
    .get("/api/contacts", async (c) => {
      return c.json({ contacts: await listContacts(db, c.get("userId")) }, 200);
    })
    .post("/api/contacts", validate("json", contactSchema), async (c) => {
      const result = await createContact(db, c.get("userId"), c.req.valid("json"));

      return result.status === "saved"
        ? c.json({ contact: result.contact }, 201)
        : c.json(DUPLICATE_ERRORS, 400);
    })
    .put(
      "/api/contacts/:id",
      validate("param", contactParamsSchema),
      validate("json", contactSchema),
      async (c) => {
        const result = await updateContact(
          db,
          c.get("userId"),
          c.req.valid("param").id,
          c.req.valid("json"),
        );

        if (result.status === "saved") {
          return c.json({ contact: result.contact }, 200);
        }

        return result.status === "duplicate"
          ? c.json(DUPLICATE_ERRORS, 400)
          : c.json({ error: "Not found" }, 404);
      },
    )
    .delete("/api/contacts/:id", validate("param", contactParamsSchema), async (c) => {
      const deleted = await deleteContact(db, c.get("userId"), c.req.valid("param").id);

      return deleted ? c.body(null, 204) : c.json({ error: "Not found" }, 404);
    });
}
