import { z } from "zod";

/** The longest message that the assistant accepts, in characters. */
export const MAX_MESSAGE_LENGTH = 4000;

export const MAX_TITLE_LENGTH = 80;

export const sessionParamsSchema = z.object({ sessionId: z.uuid() });

export const chatQuerySchema = z.object({ sessionId: z.uuid() });

/**
 * The metadata of the newest message of a chat request. The client sends the conversation's title
 * with every message, and it is stored with the history.
 */
export const chatMetadataSchema = z.object({
  title: z.string().trim().min(1).max(MAX_TITLE_LENGTH).optional(),
});
