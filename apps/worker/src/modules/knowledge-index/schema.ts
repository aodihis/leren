import { z } from "zod";

/** The payload of a request to index a playbook. */
export const knowledgeIndexPayloadSchema = z.preprocess(
  (payload) =>
    typeof payload === "object" &&
    payload !== null &&
    "itemId" in payload &&
    !("playbookId" in payload)
      ? { playbookId: payload.itemId }
      : payload,
  z.object({ playbookId: z.uuid() }),
);

export type KnowledgeIndexPayload = z.infer<typeof knowledgeIndexPayloadSchema>;

export const knowledgeDriftPayloadSchema = z.object({});

export type KnowledgeDriftPayload = z.infer<typeof knowledgeDriftPayloadSchema>;
