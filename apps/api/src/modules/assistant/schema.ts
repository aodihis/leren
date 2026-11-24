import { z } from "zod";

/** The longest message the assistant accepts. */
export const MAX_MESSAGE_LENGTH = 4000;

export const MAX_TITLE_LENGTH = 80;

export const sessionParamsSchema = z.object({ sessionId: z.uuid() });

export const chatQuerySchema = z.object({ sessionId: z.uuid() });

/** The metadata of the newest chat message. */
export const chatMetadataSchema = z.object({
  title: z.string().trim().min(1).max(MAX_TITLE_LENGTH).optional(),
});
