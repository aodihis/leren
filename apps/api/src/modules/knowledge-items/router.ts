import type { Db } from "@leren/db";
import { Hono } from "hono";

import { validate } from "../../validation";
import { requireUser } from "../auth/middleware";
import type { AuthVariables } from "../auth/middleware";
import type { Auth } from "../auth/service";
import {
  knowledgeItemListQuerySchema,
  knowledgeItemParamsSchema,
  knowledgeItemSchema,
  knowledgeItemTransitionParamsSchema,
} from "./schema";
import { createItem, deleteItem, getItem, listItems, transitionItem, updateItem } from "./service";

/**
 * Mounts the routes of the signed-in user's knowledge items under `/api/knowledge-items`. Every
 * route requires a session and every query is scoped by the session's user, so an item of another
 * user is reported as not found. The approval status changes only through
 * `POST /api/knowledge-items/:id/:action`, so a body sent to create or replace an item cannot
 * approve it.
 */
export function createKnowledgeItemsRouter(auth: Auth, db: Db) {
  return new Hono<{ Variables: AuthVariables }>()
    .use("/api/knowledge-items/*", requireUser(auth))
    .use("/api/knowledge-items", requireUser(auth))
    .get("/api/knowledge-items", validate("query", knowledgeItemListQuerySchema), async (c) => {
      const items = await listItems(db, c.get("userId"), c.req.valid("query"));

      return c.json({ items }, 200);
    })
    .post("/api/knowledge-items", validate("json", knowledgeItemSchema), async (c) => {
      const result = await createItem(db, c.get("userId"), c.req.valid("json"));

      return result.status === "saved"
        ? c.json({ item: result.item }, 201)
        : c.json({ fieldErrors: result.status === "invalid" ? result.fieldErrors : {} }, 400);
    })
    .get("/api/knowledge-items/:id", validate("param", knowledgeItemParamsSchema), async (c) => {
      const item = await getItem(db, c.get("userId"), c.req.valid("param").id);

      return item ? c.json({ item }, 200) : c.json({ error: "Not found" }, 404);
    })
    .put(
      "/api/knowledge-items/:id",
      validate("param", knowledgeItemParamsSchema),
      validate("json", knowledgeItemSchema),
      async (c) => {
        const result = await updateItem(
          db,
          c.get("userId"),
          c.req.valid("param").id,
          c.req.valid("json"),
        );

        if (result.status === "saved") {
          return c.json({ item: result.item }, 200);
        }

        return result.status === "invalid"
          ? c.json({ fieldErrors: result.fieldErrors }, 400)
          : c.json({ error: "Not found" }, 404);
      },
    )
    .post(
      "/api/knowledge-items/:id/:action",
      validate("param", knowledgeItemTransitionParamsSchema),
      async (c) => {
        const { id, action } = c.req.valid("param");
        const result = await transitionItem(db, c.get("userId"), id, action);

        if (result.status === "saved") {
          return c.json({ item: result.item }, 200);
        }

        return result.status === "conflict"
          ? c.json({ error: "The status of the item does not allow this action" }, 409)
          : c.json({ error: "Not found" }, 404);
      },
    )
    .delete("/api/knowledge-items/:id", validate("param", knowledgeItemParamsSchema), async (c) => {
      const deleted = await deleteItem(db, c.get("userId"), c.req.valid("param").id);

      return deleted ? c.body(null, 204) : c.json({ error: "Not found" }, 404);
    });
}
