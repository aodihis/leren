import { z } from "zod";

/** The provider in the path. An unknown or disabled provider is answered with not found. */
export const providerParamsSchema = z.object({ provider: z.string().min(1).max(50) });

export const channelAccountParamsSchema = z.object({ id: z.uuid() });

/**
 * The query that a provider appends when it redirects the browser back. Every field is optional
 * because a refusal carries `error` and no `code`, and the handler reports each missing field.
 */
export const callbackQuerySchema = z.object({
  code: z.string().max(2048).optional(),
  state: z.string().max(512).optional(),
  error: z.string().max(200).optional(),
});

/** The address whose server settings are suggested. */
export const settingsQuerySchema = z.object({ address: z.email().max(320) });

/** The reasons that a connection can fail, which the callback reports to the platform. */
export type ConnectionErrorCode =
  | "denied"
  | "invalid_state"
  | "conflict"
  | "limit"
  | "unavailable"
  | "failed";
