import { z } from "zod";

/** The provider in the path. */
export const providerParamsSchema = z.object({ provider: z.string().min(1).max(50) });

export const channelAccountParamsSchema = z.object({ id: z.uuid() });

/** The query a provider appends on redirect. */
export const callbackQuerySchema = z.object({
  code: z.string().max(2048).optional(),
  state: z.string().max(512).optional(),
  error: z.string().max(200).optional(),
});

/** The reasons that a connection can fail. */
export type ConnectionErrorCode =
  | "denied"
  | "invalid_state"
  | "conflict"
  | "limit"
  | "unavailable"
  | "failed";
