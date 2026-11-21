import { z } from "zod";

const MAX_EXAMPLES = 50;
const MAX_CONTACTS = 20;
const CONTACT_PATTERN = /^([^\s,@]+@[^\s,@]+\.[^\s,@]+|@?[\w.-]+)$/;

/**
 * The body of a request that creates or replaces a knowledge item. The bounds are ISO 8601 instants
 * with an offset and a null bound is open. An item whose validity ends before it starts is
 * rejected. The approval status is not part of the body, because it changes only through the
 * approve, archive and restore routes.
 */
export const knowledgeItemSchema = z
  .object({
    ruleId: z.uuid(),
    topic: z.string().trim().min(1, "Enter a topic").max(200),
    examples: z.array(z.string().trim().min(1).max(500)).max(MAX_EXAMPLES),
    response: z.string().trim().min(1, "Enter a response").max(5000),
    restrictions: z.string().trim().max(2000),
    validFrom: z.iso.datetime({ offset: true }).nullable(),
    validUntil: z.iso.datetime({ offset: true }).nullable(),
    contacts: z
      .array(z.string().trim().regex(CONTACT_PATTERN, "Enter an email address or a handle"))
      .max(MAX_CONTACTS),
  })
  .refine(
    (item) =>
      !item.validFrom || !item.validUntil || new Date(item.validFrom) <= new Date(item.validUntil),
    { path: ["validUntil"], message: "The end must not be before the start" },
  );

export const knowledgeItemParamsSchema = z.object({ id: z.uuid() });

export const knowledgeItemTransitionParamsSchema = z.object({
  id: z.uuid(),
  action: z.enum(["approve", "archive", "restore"]),
});

/**
 * The filters of the list route. `usable=true` keeps only the items that the assistant may use
 * now.
 */
export const knowledgeItemListQuerySchema = z.object({
  ruleId: z.uuid().optional(),
  status: z.enum(["draft", "approved", "archived"]).optional(),
  usable: z.enum(["true"]).optional(),
});

export type KnowledgeItemInput = z.infer<typeof knowledgeItemSchema>;

export type KnowledgeItemListQuery = z.infer<typeof knowledgeItemListQuerySchema>;
