import { z } from "zod";

export const knowledgeIndexPayloadSchema = z.object({
  itemId: z.uuid(),
});

export type KnowledgeIndexPayload = z.infer<typeof knowledgeIndexPayloadSchema>;

export const knowledgeDriftPayloadSchema = z.object({});

export type KnowledgeDriftPayload = z.infer<typeof knowledgeDriftPayloadSchema>;
